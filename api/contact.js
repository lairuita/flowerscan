// /api/contact.js
// Vercel serverless function — contact form handler.
//
// POST body: { firstName, lastName, email, message }
// Sends an email to hello@flowerscan.ca via Resend.

const { Resend } = require('resend');

let resend;
function getResend() {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, lastName, email, message } = req.body || {};

  if (!firstName || !lastName || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — contact form email skipped');
    return res.status(200).json({ ok: true });
  }

  try {
    await getResend().emails.send({
      from: 'flowerscan contact form <onboarding@resend.dev>',
      to:   'hello@flowerscan.ca',
      replyTo: email,
      subject: `New message from ${firstName} ${lastName}`,
      text: [
        `Name: ${firstName} ${lastName}`,
        `Email: ${email}`,
        ``,
        `Message:`,
        message,
      ].join('\n'),
      html: `
        <p><strong>Name:</strong> ${firstName} ${lastName}</p>
        <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
        <hr>
        <p><strong>Message:</strong></p>
        <p style="white-space:pre-wrap">${message.replace(/</g, '&lt;')}</p>
      `,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact email send failed:', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
