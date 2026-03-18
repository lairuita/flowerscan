// /api/workshop-status.js
// Returns sold-out status for each workshop by counting completed Stripe sessions.
//
// GET /api/workshop-status
// Response: { lychuu: { soldOut: bool, spotsLeft: int }, coffeeRonin: { soldOut: bool, spotsLeft: int } }
//
// Requires env vars:
//   STRIPE_SECRET_KEY               — sk_live_xxx
//   STRIPE_LYCHUU_PAYMENT_LINK_ID   — pl_xxx (Dashboard → Payment Links → Lychuu buy button)
//   STRIPE_COFFEE_RONIN_PAYMENT_LINK_ID — pl_xxx (Dashboard → Payment Links → Coffee Ronin buy button)

const Stripe = require('stripe');

const WORKSHOPS = {
  lychuu: {
    paymentLinkId: process.env.STRIPE_LYCHUU_PAYMENT_LINK_ID,
    limit: 8,
  },
  coffeeRonin: {
    paymentLinkId: process.env.STRIPE_COFFEE_RONIN_PAYMENT_LINK_ID,
    limit: 6,
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // If no secret key, return all available (safe fallback)
  if (!process.env.STRIPE_SECRET_KEY) {
    const fallback = {};
    for (const key of Object.keys(WORKSHOPS)) {
      fallback[key] = { soldOut: false, spotsLeft: WORKSHOPS[key].limit };
    }
    return res.json(fallback);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const result = {};

  for (const [key, workshop] of Object.entries(WORKSHOPS)) {
    if (!workshop.paymentLinkId) {
      result[key] = { soldOut: false, spotsLeft: workshop.limit };
      continue;
    }

    try {
      let count = 0;
      let hasMore = true;
      let startingAfter;

      while (hasMore) {
        const sessions = await stripe.checkout.sessions.list({
          payment_link: workshop.paymentLinkId,
          status: 'complete',
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

        count += sessions.data.length;
        hasMore = sessions.has_more;
        if (hasMore) startingAfter = sessions.data[sessions.data.length - 1].id;
      }

      result[key] = {
        soldOut: count >= workshop.limit,
        spotsLeft: Math.max(0, workshop.limit - count),
      };
    } catch (err) {
      console.error(`workshop-status: failed to count sessions for ${key}:`, err.message);
      // Fail open — show button rather than incorrectly blocking a sale
      result[key] = { soldOut: false, spotsLeft: workshop.limit };
    }
  }

  // Cache for 60s on CDN edge, serve stale up to 5min while revalidating
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.json(result);
};
