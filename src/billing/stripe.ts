import Stripe from 'stripe';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { config } from '../config.js';
import { query } from '../db/client.js';
import { generateApiKey } from '../auth.js';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = new Stripe(config.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export const billingRouter = new Hono();

// POST /v1/billing/register — create account + API key + Stripe customer
billingRouter.post('/register', async (c) => {
  const { email } = await c.req.json() as { email?: string };

  if (!email) {
    return c.json({ error: 'Email required' }, 400);
  }

  // Generate API key
  const { key, prefix } = await generateApiKey(email);

  // Create Stripe customer if configured
  let stripeCustomerId: string | null = null;
  if (config.STRIPE_SECRET_KEY) {
    try {
      const customer = await getStripe().customers.create({ email });
      stripeCustomerId = customer.id;

      // Link Stripe customer to API key
      await query(
        'UPDATE api_keys SET stripe_customer_id = $1 WHERE key_prefix = $2',
        [stripeCustomerId, prefix]
      );
    } catch (err) {
      console.warn('Stripe customer creation failed:', err);
    }
  }

  return c.json({
    api_key: key,
    key_prefix: prefix,
    tier: 'free',
    monthly_limit: 1000,
    stripe_customer_id: stripeCustomerId,
    message: 'Store your API key securely — it will not be shown again.',
  });
});

// POST /v1/billing/upgrade — upgrade to paid tier
billingRouter.post('/upgrade', async (c) => {
  if (!config.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Billing not configured' }, 503);
  }

  const apiKey = (c as any).get('apiKey');
  if (!apiKey) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  if (!apiKey.stripe_customer_id) {
    return c.json({ error: 'No Stripe customer linked. Register first.' }, 400);
  }

  try {
    // Create a checkout session for usage-based billing
    const session = await getStripe().checkout.sessions.create({
      customer: apiKey.stripe_customer_id,
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Switchlane Pro',
            description: 'Usage-based routing — $0.001 per route request',
          },
          unit_amount: 100, // $1/month base + metered
          recurring: { interval: 'month' },
        },
      }],
      success_url: 'https://router.troialabs.ai/billing/success',
      cancel_url: 'https://router.troialabs.ai/billing/cancel',
    });

    return c.json({ checkout_url: session.url });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /v1/billing/usage — current usage stats
billingRouter.get('/usage', async (c) => {
  const apiKey = (c as any).get('apiKey');
  if (!apiKey) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  return c.json({
    tier: apiKey.tier,
    requests_this_month: apiKey.requests_this_month,
    monthly_limit: apiKey.monthly_limit,
    cost_per_request: apiKey.tier === 'paid' ? 0.001 : 0,
    estimated_bill_usd: apiKey.tier === 'paid'
      ? Math.round(apiKey.requests_this_month * 0.001 * 100) / 100
      : 0,
  });
});

/**
 * Report usage to Stripe for metered billing.
 */
export async function reportStripeUsage(stripeCustomerId: string, quantity: number): Promise<void> {
  if (!config.STRIPE_SECRET_KEY) return;

  try {
    // Report usage via Stripe Billing Meter API
    await getStripe().billing.meterEvents.create({
      event_name: 'route_request',
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: String(quantity),
      },
    });
  } catch (err) {
    console.warn('Stripe usage report failed:', err);
  }
}

/**
 * Reset monthly counters (run on 1st of each month).
 */
export async function resetMonthlyCounters(): Promise<void> {
  await query('UPDATE api_keys SET requests_this_month = 0');
  console.log('Monthly usage counters reset.');
}
