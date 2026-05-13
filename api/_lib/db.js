import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.POSTGRES_URL);

export async function getUser(uid) {
  const rows = await sql`SELECT * FROM users WHERE id = ${uid} LIMIT 1`;
  return rows[0] || null;
}

export async function upsertUser({ id, email, name, picture }) {
  const rows = await sql`
    INSERT INTO users (id, email, name, picture)
    VALUES (${id}, ${email}, ${name}, ${picture})
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      picture = EXCLUDED.picture,
      updated_at = now()
    RETURNING *
  `;
  return rows[0];
}

export async function setStripeCustomer(uid, customerId) {
  await sql`UPDATE users SET stripe_customer_id = ${customerId}, updated_at = now() WHERE id = ${uid}`;
}

export async function setSubscription(uid, { tier, customerId, subscriptionId }) {
  await sql`
    UPDATE users
    SET tier = ${tier},
        stripe_customer_id = COALESCE(${customerId}, stripe_customer_id),
        stripe_subscription_id = ${subscriptionId},
        updated_at = now()
    WHERE id = ${uid}
  `;
}

export async function getUserByCustomerId(customerId) {
  const rows = await sql`SELECT * FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1`;
  return rows[0] || null;
}
