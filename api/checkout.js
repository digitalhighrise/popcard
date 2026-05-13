import Stripe from 'stripe';
import { getUser, setStripeCustomer } from './_lib/db.js';
import { getSession } from './_lib/session.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_BY_TIER = {
  pro: process.env.STRIPE_PRICE_ID_PRO,
  team: process.env.STRIPE_PRICE_ID_TEAM,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  const { tier } = req.body || {};
  const priceId = PRICE_BY_TIER[tier];
  if (!priceId) return res.status(400).json({ error: 'Invalid tier' });

  const user = await getUser(session.uid);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const origin = req.headers.origin || `https://${req.headers.host}`;

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { uid: session.uid },
    });
    customerId = customer.id;
    await setStripeCustomer(session.uid, customerId);
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
    metadata: { uid: session.uid, tier },
    allow_promotion_codes: true,
  });

  res.status(200).json({ url: checkoutSession.url });
}
