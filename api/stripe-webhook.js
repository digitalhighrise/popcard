import Stripe from 'stripe';
import { setSubscription } from './_lib/db.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function uidFromCustomer(customerId) {
  if (!customerId) return null;
  const customer = await stripe.customers.retrieve(customerId);
  return customer?.metadata?.uid || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return res
      .status(400)
      .json({ error: `Webhook signature verification failed: ${e.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.metadata?.uid;
        const tier = session.metadata?.tier;
        if (uid && tier) {
          await setSubscription(uid, {
            tier,
            customerId: session.customer,
            subscriptionId: session.subscription,
          });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const uid = await uidFromCustomer(subscription.customer);
        if (uid) {
          const active =
            subscription.status === 'active' ||
            subscription.status === 'trialing';
          if (!active) {
            await setSubscription(uid, {
              tier: 'free',
              customerId: subscription.customer,
              subscriptionId: subscription.id,
            });
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const uid = await uidFromCustomer(subscription.customer);
        if (uid) {
          await setSubscription(uid, {
            tier: 'free',
            customerId: subscription.customer,
            subscriptionId: null,
          });
        }
        break;
      }
    }
  } catch (e) {
    console.error('Webhook handler error', e);
    return res.status(500).json({ error: 'Handler error' });
  }

  res.status(200).json({ received: true });
}
