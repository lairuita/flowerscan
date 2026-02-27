// /api/create-checkout-session.js
// Vercel serverless function — initializes a HelcimPay.js checkout session.
//
// POST body: { type: "starter" | "subscription" | "workshop", workshopDate?: string }
// Response:  { checkoutToken: string, secretToken: string }
//
// The frontend uses checkoutToken to render the HelcimPay.js modal iframe.
// The secretToken is stored on the frontend and sent to /api/webhook after
// payment succeeds, for server-side verification.

const axios = require('axios');

// Env vars store amounts in cents (e.g. 6500 = $65.00 CAD).
// Helcim API expects dollars, so divide by 100.
const getAmount = (type) => {
  const map = {
    starter:      parseInt(process.env.HELCIM_STARTER_AMOUNT,      10) / 100,
    subscription: parseInt(process.env.HELCIM_SUBSCRIPTION_AMOUNT, 10) / 100,
    workshop:     parseInt(process.env.HELCIM_WORKSHOP_AMOUNT,      10) / 100,
  };
  return map[type] ?? null;
};

module.exports = async function handler(req, res) {
  // CORS
  const allowed = [process.env.YOUR_DOMAIN, 'http://localhost:3000', 'http://127.0.0.1:5500'];
  const origin  = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { type } = req.body || {};
  const amount   = getAmount(type);

  if (!amount) {
    return res.status(400).json({ error: 'Invalid checkout type' });
  }

  try {
    const response = await axios.post(
      'https://api.helcim.com/v2/helcim-pay/initialize',
      {
        paymentType:   'purchase',
        amount,
        currency:      'CAD',
        paymentMethod: 'cc',
        // Ask for email and name in the modal
        customerRequest: {
          contactName: '',
          email:       '',
        },
      },
      {
        headers: {
          'api-token':    process.env.HELCIM_API_TOKEN,
          'Content-Type': 'application/json',
          'Accept':       'application/json',
        },
      }
    );

    const { checkoutToken, secretToken } = response.data;
    return res.status(200).json({ checkoutToken, secretToken });

  } catch (err) {
    const status  = err.response?.status  || 500;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    console.error('Helcim init error:', status, message);
    return res.status(500).json({ error: 'Failed to initialize payment session' });
  }
};
