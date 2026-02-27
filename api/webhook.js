// /api/webhook.js
// Vercel serverless function — post-payment processor.
//
// Called by the frontend after HelcimPay.js fires a SUCCESS event.
//
// POST body: {
//   transactionData: object,   // from event.data.eventMessage.data
//   hash:            string,   // from event.data.eventMessage.hash
//   secretToken:     string,   // stored on frontend from init response
//   type:            string,   // "starter" | "subscription" | "workshop"
//   workshopDate?:   string,   // "YYYY-MM-DD" for workshops
// }
// Response: { ok: true }

const crypto     = require('crypto');
const { google } = require('googleapis');
const { Resend } = require('resend');

// Lazy — initialised on first request so missing env vars don't crash cold starts
let resend;
function getResend() {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

// ── Hash verification ──────────────────────────────────────────────────────
// Helcim: sha256( JSON.stringify(transactionData) + secretToken )
// Mirrors the PHP/Python examples in Helcim docs.
function verifyHash(transactionData, secretToken, helcimHash) {
  try {
    // Re-serialise with no spaces (same as Helcim's canonical form)
    const jsonStr      = JSON.stringify(transactionData);
    const computedHash = crypto
      .createHash('sha256')
      .update(jsonStr + secretToken)
      .digest('hex');
    return computedHash === helcimHash;
  } catch {
    return false;
  }
}

// ── Google Sheets auth ─────────────────────────────────────────────────────
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function appendRow(sheets, range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId:   process.env.GOOGLE_SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody:     { values: [values] },
  });
}

// ── Email templates ────────────────────────────────────────────────────────
function subscriptionEmailHtml(name) {
  const firstName = name ? name.split(' ')[0] : 'there';
  return `
    <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #2C2C2C; line-height: 1.7; padding: 40px 20px;">
      <p style="font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: #9E9E8F; margin-bottom: 32px;">
        Ikebana Box &middot; flowerscan
      </p>
      <h1 style="font-weight: 300; font-size: 32px; margin-bottom: 24px;">Your Ikebana Box is on its way.</h1>
      <p>Hello ${firstName},</p>
      <p>
        Your subscription is confirmed. Your first Ikebana Box will arrive within
        the next few days — seasonal stems, a kenzan, a ceramic vessel, and your
        first arrangement instruction card.
      </p>
      <p>
        Every two weeks from here, a new box arrives timed to the natural life of
        your last arrangement. You'll receive a delivery email a day or two before
        each box with details on what's coming.
      </p>
      <p>
        Questions or changes? Email us at
        <a href="mailto:hello@flowerscan.ca" style="color: #8B7355;">hello@flowerscan.ca</a>
        or visit our <a href="${process.env.YOUR_DOMAIN}/faq.html" style="color: #8B7355;">FAQ</a>.
      </p>
      <p style="margin-top: 48px; color: #9E9E8F; font-size: 13px;">
        With care, Ikebana Box &middot; flowerscan.ca
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
        Ikebana Box &middot; flowerscan
      </p>
      <h1 style="font-weight: 300; font-size: 32px; margin-bottom: 24px;">You're booked.</h1>
      <p>Hello ${firstName},</p>
      <p>
        Your spot in the ikebana workshop on <strong>${displayDate}</strong> is confirmed.
      </p>
      <p>
        The session runs 2:00 – 4:00 pm. Location details will follow in a separate
        email closer to the date. All materials are provided.
      </p>
      <ul style="padding-left: 20px; color: #2C2C2C; margin-block: 16px;">
        <li>Duration: 2 hours</li>
        <li>All materials included — stems, vessel or kenzan, clippers</li>
        <li>Light refreshments</li>
        <li>You take your arrangement home</li>
      </ul>
      <p style="font-size: 14px; color: #9E9E8F;">
        To cancel or transfer your spot, email
        <a href="mailto:hello@flowerscan.ca" style="color: #8B7355;">hello@flowerscan.ca</a>
        at least 48 hours before the session.
      </p>
      <p style="margin-top: 48px; color: #9E9E8F; font-size: 13px;">
        See you soon, Ikebana Box &middot; flowerscan.ca
      </p>
    </div>
  `;
}

// ── Main handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  const allowed = [process.env.YOUR_DOMAIN, 'http://localhost:3000', 'http://127.0.0.1:5500'];
  const origin  = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { transactionData, hash, secretToken, type, workshopDate } = req.body || {};

  if (!transactionData || !hash || !secretToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Verify the transaction hash
  if (!verifyHash(transactionData, secretToken, hash)) {
    console.error('Hash verification failed');
    return res.status(400).json({ error: 'Invalid transaction hash' });
  }

  const name  = transactionData.cardHolderName || '';
  const email = transactionData.customerCode   || '';   // Helcim uses customerCode; email may come separately
  const now   = new Date().toISOString().split('T')[0];

  try {
    const sheets     = getSheetsClient();
    const isWorkshop = type === 'workshop';

    if (isWorkshop) {
      // Write to Workshop Bookings sheet
      // Columns: Name | Email | Workshop Date | Style | Status | Helcim Payment ID | Created At
      await appendRow(sheets, `${process.env.AIRTABLE_WORKSHOPS_TABLE}!A:G`, [
        name,
        email,
        workshopDate || '',
        '',   // Style — can be added to the request payload if needed
        'Confirmed',
        String(transactionData.transactionId || ''),
        now,
      ]);

      await getResend().emails.send({
        from:    'Ikebana Box <hello@flowerscan.ca>',
        to:      email,
        subject: `You're booked — Ikebana Workshop ${workshopDate || ''}`,
        html:    workshopEmailHtml(name, workshopDate),
      });

    } else {
      // Write to Subscribers sheet
      // Columns: Name | Email | Plan | Start Date | Status | Helcim Customer ID | Created At
      await appendRow(sheets, `${process.env.AIRTABLE_SUBSCRIBERS_TABLE}!A:G`, [
        name,
        email,
        type === 'starter' ? 'Starter' : 'Recurring',
        now,
        'Active',
        String(transactionData.customerCode || ''),
        now,
      ]);

      await getResend().emails.send({
        from:    'Ikebana Box <hello@flowerscan.ca>',
        to:      email,
        subject: 'Your Ikebana Box is on its way',
        html:    subscriptionEmailHtml(name),
      });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Post-payment processing error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};
