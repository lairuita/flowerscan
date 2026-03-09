// /api/chat.js
// Vercel serverless function — AI chat assistant powered by Gemini 1.5 Flash (free tier)
// Uses REST API directly — no SDK dependency needed

const SYSTEM_PROMPT = `You are a gentle, knowledgeable assistant for flowerscan — an ikebana-inspired flower arrangement service in Toronto, Ontario, Canada.

About flowerscan:
- Bi-weekly flower subscription called "Ikebana Box" — curated seasonal stems delivered in Toronto
- Intimate in-person workshops: small groups, all materials included, no experience needed
- Philosophy: wabi-sabi — quiet beauty, impermanence, natural imperfection
- Contact: flowerscan.ca@gmail.com | Instagram: @flower.scan

Upcoming workshops ($80 CAD + tax per person, all materials provided):
- Saturday, March 28, 2026 — Coffee Ronin, Scarborough · 11:00 am – 12:30 pm
- Saturday, April 4, 2026 — Charlie's Tea North York · 11:00 am – 1:30 pm
- Sunday, April 19, 2026 — Space Coffee · 10:00 – 11:30 am

To book a workshop: visit the Workshops page on the site and use the RSVP link.
To subscribe to Ikebana Box: visit the Ikebana Box page on the site.

Tone: Keep responses short, warm, and unhurried. Simple language. No hype. If asked something you're unsure about, suggest emailing flowerscan.ca@gmail.com.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers.origin;
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

  // Convert messages to Gemini format
  const contents = messages.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 400 },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini error:', data);
      return res.status(500).json({ error: 'Something went wrong. Please email flowerscan.ca@gmail.com.' });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    res.status(200).json({ reply: text });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Something went wrong. Please email flowerscan.ca@gmail.com.' });
  }
};
