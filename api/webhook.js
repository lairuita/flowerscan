// /api/webhook.js
// Vercel serverless function — handles Stripe webhook events.
//
// Listens for: checkout.session.completed
//   - subscription / starter → write to Airtable Subscribers + send welcome email
//   - workshop               → write to Airtable Workshop Bookings + send confirmation email
//
// Stripe requires the raw request body for signature verification,
// so we disable Vercel's default body parsing via the config export.

const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Vercel: disable body parsing so we can read raw bytes ──────────────────
module.exports.config = {
  api: { bodyParser: false },
};

// ── Helper: collect raw body buffer ───────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Helper: write a record to Airtable via REST API ───────────────────────
async function writeToAirtable(tableName, fields) {
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable error ${response.status}: ${text}`);
  }

  return response.json();
}

// ── Email templates ────────────────────────────────────────────────────────
function subscriptionEmailHtml(name) {
  const firstName = name ? name.split(' ')[0] : 'there';
  return `
    <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #2C2C2C; line-height: 1.7; padding: 40px 20px;">
      <p style="font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: #9E9E8F; margin-bottom: 32px;">
        Ikebana Box · flowerscan
      </p>
      <h1 style="font-weight: 300; font-size: 32px; margin-bottom: 24px;">Your Ikebana Box is on its way.</h1>
      <p>Hello ${firstName},</p>
      <p>
        Your subscription is confirmed. Your first Ikebana Box will arrive within the next
        few days — seasonal stems, a kenzan, a ceramic vessel, and your first arrangement
        instruction card.
      </p>
      <p>
        Every two weeks from here, a new box arrives timed to the natural life of your
        last arrangement. You'll receive a delivery email a day or two before each box
        with details on what's coming.
      </p>
      <p>
        You can pause, skip, or cancel anytime through your
        <a href="https://billing.stripe.com/p/login/test_placeholder" style="color: #8B7355;">subscriber portal</a>.
      </p>
      <p style="margin-top: 32px; color: #9E9E8F; font-size: 14px;">
        Questions? Reply to this email or write to
        <a href="mailto:hello@flowerscan.ca" style="color: #8B7355;">hello@flowerscan.ca</a>.
      </p>
      <p style="margin-top: 48px; color: #9E9E8F; font-size: 13px;">
        — flowerscan · Toronto, ON
      </p>
    </div>
  `;
}

function workshopEmailHtml(name, workshopDate) {
  const firstName   = name ? name.split(' ')[0] : 'there';
  const displayDate = workshopDate
    ? new Date(workshopDate + 'T12:00:00').toLocaleDateString('en-CA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : 'your upcoming session';

  return `
    <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #2C2C2C; line-height: 1.7; padding: 40px 20px;">
      <p style="font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: #9E9E8F; margin-bottom: 32px;">
        Ikebana Box · flowerscan
      </p>
      <h1 style="font-weight: 300; font-size: 32px; margin-bottom: 24px;">You're booked.</h1>
      <p>Hello ${firstName},</p>
      <p>
        Your spot in the ikebana workshop on <strong>${displayDate}</strong> is confirmed.
      </p>
      <p>
        The session runs 2:00 – 4:00 pm. Location details will follow in a separate email
        closer to the date. All materials are provided — no need to bring anything except
        yourself and a little curiosity.
      </p>
      <ul style="padding-left: 20px; color: #2C2C2C;">
        <li>Duration: 2 hours</li>
        <li>All materials included (stems, vessel or kenzan, clippers)</li>
        <li>Light refreshments</li>
        <li>You take your arrangement home</li>
      </ul>
      <p style="margin-top: 24px; font-size: 14px; color: #9E9E8F;">
        Cancellations more than 72 hours before the session receive a full refund.
        Within 72 hours, your spot can be transferred to another person.
        Email <a href="mailto:hello@flowerscan.ca" style="color: #8B7355;">hello@flowerscan.ca</a> to arrange.
      </p>
      <p style="margin-top: 48px; color: #9E9E8F; font-size: 13px;">
        — flowerscan · Toronto, ON
      </p>
    </div>
  `;
}

// ── Main handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const sig     = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session      = event.data.object;
  const customerName  = session.customer_details?.name  || '';
  const customerEmail = session.customer_details?.email || '';
  const sessionMode   = session.mode;           // 'payment' | 'subscription'
  const workshopDate  = session.metadata?.workshop_date || '';

  // Determine product type from metadata or session mode
  // Workshop sessions are always one-time payments with a workshop_date in metadata
  const isWorkshop     = Boolean(workshopDate);
  const isSubscription = sessionMode === 'subscription';
  const isStarter      = sessionMode === 'payment' && !isWorkshop;

  try {
    if (isWorkshop) {
      // ── Workshop booking ──────────────────────────────────────────────
      await writeToAirtable(process.env.AIRTABLE_WORKSHOPS_TABLE, {
        Name:               customerName,
        Email:              customerEmail,
        'Workshop Date':    workshopDate,
        Style:              '',                   // Could be added to metadata if needed
        Status:             'Confirmed',
        'Stripe Payment ID': session.payment_intent || session.id,
      });

      await resend.emails.send({
        from:    'Ikebana Box <hello@flowerscan.ca>',
        to:      customerEmail,
        subject: `You're booked — Ikebana Workshop ${workshopDate}`,
        html:    workshopEmailHtml(customerName, workshopDate),
      });

    } else {
      // ── Subscription or Starter box ───────────────────────────────────
      await writeToAirtable(process.env.AIRTABLE_SUBSCRIBERS_TABLE, {
        Name:                 customerName,
        Email:                customerEmail,
        Plan:                 isSubscription ? 'Recurring' : 'Starter',
        'Start Date':         new Date().toISOString().split('T')[0],
        Status:               'Active',
        'Stripe Customer ID': session.customer || '',
      });

      await resend.emails.send({
        from:    'Ikebana Box <hello@flowerscan.ca>',
        to:      customerEmail,
        subject: 'Your Ikebana Box is on its way',
        html:    subscriptionEmailHtml(customerName),
      });
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Post-checkout processing error:', err.message);
    // Return 200 so Stripe does not retry — log and investigate separately
    return res.status(200).json({ received: true, warning: err.message });
  }
};
