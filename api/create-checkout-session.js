// /api/create-checkout-session.js
// Vercel serverless function — creates a Stripe Checkout session
// and returns the hosted checkout URL.
//
// POST body: { type: "starter" | "subscription" | "workshop", workshopDate?: string }
// Response:  { url: string }

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_MAP = {
  starter:      process.env.STRIPE_STARTER_PRICE_ID,
  subscription: process.env.STRIPE_SUBSCRIPTION_PRICE_ID,
  workshop:     process.env.STRIPE_WORKSHOP_PRICE_ID,
};

module.exports = async function handler(req, res) {
  // CORS — allow requests from the production domain and localhost
  const allowed = [process.env.YOUR_DOMAIN, 'http://localhost:3000', 'http://127.0.0.1:5500'];
  const origin  = req.headers.origin;
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, workshopDate } = req.body || {};

  if (!type || !PRICE_MAP[type]) {
    return res.status(400).json({ error: 'Invalid checkout type' });
  }

  const priceId = PRICE_MAP[type];
  const domain  = process.env.YOUR_DOMAIN;

  // Build session params based on payment type
  const isSubscription = type === 'subscription';

  const sessionParams = {
    mode:                isSubscription ? 'subscription' : 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price:    priceId,
        quantity: 1,
      },
    ],
    success_url: `${domain}/success.html?type=${type}`,
    cancel_url:  type === 'workshop'
                   ? `${domain}/workshops.html`
                   : `${domain}/subscription.html`,
    // Collect shipping address for box deliveries
    ...(type !== 'workshop' && {
      shipping_address_collection: {
        allowed_countries: ['CA'],
      },
    }),
    // Store workshop date in metadata so the webhook can read it
    ...(type === 'workshop' && workshopDate && {
      metadata: {
        workshop_date: workshopDate,
      },
    }),
    // Stripe customer portal for subscription management
    ...(isSubscription && {
      subscription_data: {
        metadata: {
          source: 'ikebana-box',
        },
      },
    }),
  };

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
