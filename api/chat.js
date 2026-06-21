// /api/chat.js
// Vercel serverless function — AI chat assistant powered by Gemini
// Dynamically reads site content so the bot stays in sync with the site automatically

const fs   = require('fs');
const path = require('path');

// ── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&times;/g, '×')
    .replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBetween(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) return '';
  const end = html.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

// ── Content extraction ────────────────────────────────────────────────────────

function getSiteContext() {
  const root = process.cwd();

  try {
    // Workshops — extract upcoming dates section
    const workshopsHtml = fs.readFileSync(path.join(root, 'workshops.html'), 'utf8');
    const workshopsSection = extractBetween(
      workshopsHtml,
      'Upcoming dates',
      'id="past-heading"'
    );
    const workshopsText = stripTags(workshopsSection);

    // Subscription — extract pricing/plan info from meta description + hero
    const subHtml = fs.readFileSync(path.join(root, 'subscription.html'), 'utf8');
    const subMeta = (subHtml.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
    const subSection = extractBetween(subHtml, 'id="subscription-heading"', 'id="expect-heading"');
    const subText = stripTags(subSection);

    return `
WORKSHOPS (live from site):
${workshopsText}

IKEBANA BOX SUBSCRIPTION (live from site):
${subMeta}
${subText}
`.trim();

  } catch (e) {
    console.error('Failed to read site content:', e.message);
    return '';
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin  = req.headers.origin;
  const allowed = process.env.YOUR_DOMAIN || 'https://www.flowerscan.ca';
  if (origin === allowed || origin === 'http://localhost:3000') {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  const siteContext = getSiteContext();

  const systemPrompt = `You are a gentle, knowledgeable assistant for flowerscan — an ikebana-inspired flower arrangement service in Toronto, Ontario, Canada.

About flowerscan:
- Bi-weekly flower subscription called "Ikebana Box" — curated seasonal stems delivered in Toronto
- Intimate in-person workshops: small groups, all materials included, no experience needed
- Philosophy: wabi-sabi — quiet beauty, impermanence, natural imperfection
- Contact: hello@flowerscan.ca | Instagram: @flower.scan

The following is live content extracted directly from the website — use this as your source of truth:

${siteContext}

To book a workshop: visit the Workshops page and use the RSVP link.
To subscribe to Ikebana Box: visit the Ikebana Box page.

Tone: Keep responses short, warm, and unhurried. Simple language. No hype. If asked something you're unsure about, suggest emailing hello@flowerscan.ca.`;

  // Convert messages to Gemini format
  const contents = messages.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 400 },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini error:', data);
      const geminiMsg = data?.error?.message || JSON.stringify(data);
      return res.status(500).json({ error: 'Gemini error: ' + geminiMsg });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    res.status(200).json({ reply: text });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Something went wrong. Please email hello@flowerscan.ca.' });
  }
};
