# replicate.md — How to Build a Site Like flowerscan.ca

Internal reference for rebuilding this stack for a new client. Everything here reflects what was actually built and deployed for Ikebana Box (flowerscan.ca).

---

## What this is

A multi-page marketing + e-commerce website for a small product/service business. It supports:

- Static content pages (home, about, gallery, FAQ)
- A product/subscription page with live payment checkout
- An event booking page (workshops) with date-based checkout
- Automatic confirmation emails after purchase
- A Google Sheet that logs every order automatically
- A custom domain with SSL, hosted on Vercel

No CMS, no database, no React, no npm build step for the frontend.

---

## Client Accounts Required

Before starting a build, the client needs to create (or hand over access to) the following accounts. All are free unless noted.

| Service | Purpose | Notes |
|---|---|---|
| **GitHub** | Hosts the code, triggers Vercel deploys | Free. Client should own the repo — we push to it. |
| **Vercel** | Hosts the website and API functions | Free tier is enough. Sign up with GitHub. Client should own the project under their account. |
| **Domain registrar** | Custom domain (e.g. Namecheap, Google Domains) | Client pays ~$15–20/year. We configure DNS records. |
| **Helcim** *(Tier 2+ only)* | Payment processing | Canadian processor. Client must apply for a merchant account — requires business info, takes 1–3 days. We handle the integration once approved. |
| **Google Cloud** *(Tier 2+ only)* | Google Sheets API access | Free. Client needs a Google account. We set up the Cloud project, service account, and share the Sheet. |
| **Resend** *(Tier 2+ only)* | Transactional emails | Free up to ~3,000 emails/month. Requires domain verification (DNS TXT record). |
| **Anthropic** *(Tier 3 only)* | Claude API for AI assistant | Pay-per-use. Client creates account and adds a credit card. Costs are minimal at small volume. |

### What we handle vs. what the client handles

**Client does:**
- Create accounts listed above
- Apply for Helcim merchant account (requires their business info)
- Purchase the domain
- Share credentials/access with us for setup

**We do:**
- Set up GitHub repo and Vercel project
- Configure all DNS records
- Set up Google Cloud project, service account, and Sheet
- Set up Resend domain verification
- Configure all environment variables in Vercel
- Build and deploy everything

---

## Stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | Plain HTML + CSS + Vanilla JS | No build tooling, fast to ship, easy to maintain |
| Hosting | Vercel (free tier) | Git-connected, zero-config deploys, supports serverless functions |
| Payments | Helcim (HelcimPay.js) | Canadian processor, no redirect, modal-based, lower fees than Stripe for CAD |
| Email | Resend | Simple API, reliable deliverability, free tier covers small volume |
| Data logging | Google Sheets API | Client-readable order log, no database needed |
| DNS | Namecheap → Vercel | Domain registered elsewhere, pointed to Vercel via A/CNAME records |

---

## File Structure

```
/
├── index.html              # Home page
├── subscription.html       # Product / subscription page with pricing + checkout
├── workshops.html          # Event listings + booking
├── gallery.html            # Photo gallery
├── about.html              # About the brand
├── faq.html                # Full FAQ accordion
├── success.html            # Post-payment confirmation page
├── CNAME                   # Custom domain (flowerscan.ca) — Vercel reads this
├── vercel.json             # Routing config for Vercel
├── package.json            # Node deps for API functions only
├── css/
│   └── style.css           # Full design system (~19 sections, CSS custom properties)
├── js/
│   └── main.js             # Hero animation + FAQ accordion + Helcim checkout
├── api/
│   ├── create-checkout-session.js   # Serverless: init Helcim session
│   └── webhook.js                   # Serverless: post-payment (Sheets + email)
└── assets/                 # Images (not committed in this repo)
```

---

## Payment Flow (Helcim)

Helcim uses a modal iframe (HelcimPay.js). There is no redirect to an external payment page.

```
1. User clicks "Buy" button (data-checkout-type="starter|subscription|workshop")
2. main.js → POST /api/create-checkout-session { type, workshopDate? }
3. Server → POST https://api.helcim.com/v2/helcim-pay/initialize
   → returns { checkoutToken, secretToken }
4. main.js loads helcim-pay.js script, calls appendHelcimPayIframe(checkoutToken)
   → modal appears in-page
5. User completes payment in modal
6. Helcim fires window 'message' event:
   { eventName: "helcim-pay-js-" + checkoutToken, eventStatus, eventMessage: { hash, data } }
7. On SUCCESS → main.js → POST /api/webhook
   { transactionData, hash, secretToken, type, workshopDate, customerEmail }
8. Webhook: SHA-256 verify hash, write to Google Sheets, send Resend email
9. Redirect to /success.html?type=...
```

The `secretToken` is used for server-side hash verification to confirm the transaction wasn't tampered with. This is Helcim's built-in anti-fraud mechanism.

---

## API Functions

### `/api/create-checkout-session.js`

- Accepts: `{ type: "starter" | "subscription" | "workshop" }`
- Reads amount from env vars (in cents, divided by 100 for Helcim)
- Calls Helcim API with amount + currency + payment type
- Returns: `{ checkoutToken, secretToken }`
- Dependencies: `axios`

### `/api/webhook.js`

- Accepts: `{ transactionData, hash, secretToken, type, workshopDate, customerEmail }`
- Verifies SHA-256 hash of transactionData + secretToken
- Appends a row to the correct Google Sheet tab
- Sends a branded HTML confirmation email via Resend
- Google Sheets and Resend are both optional — missing env vars skip those steps gracefully
- Dependencies: `googleapis`, `resend`

---

## Environment Variables

All set in the Vercel dashboard (Settings → Environment Variables). Never committed to git.

```
# Helcim
HELCIM_API_TOKEN=
HELCIM_ACCOUNT_ID=              # Not currently used in code but good to store
HELCIM_STARTER_AMOUNT=6500      # In cents. $65.00 CAD
HELCIM_SUBSCRIPTION_AMOUNT=5500 # $55.00 CAD
HELCIM_WORKSHOP_AMOUNT=8500     # $85.00 CAD

# Google Sheets
GOOGLE_SHEET_ID=                # The ID from the sheet URL
GOOGLE_SERVICE_ACCOUNT_EMAIL=   # service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=             # Full PEM key, paste with literal \n between lines

# Google Sheet tab names (env var names reuse Airtable naming convention from early draft)
AIRTABLE_SUBSCRIBERS_TABLE=Subscribers
AIRTABLE_WORKSHOPS_TABLE=Workshop Bookings

# Resend
RESEND_API_KEY=

# Domain (used for CORS allowlist)
YOUR_DOMAIN=https://www.flowerscan.ca
```

---

## Google Sheets Setup

Create one Google Sheet with two tabs:

**Subscribers** (columns A–G)
| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Name | Email | Plan | Start Date | Status | Helcim Customer ID | Created At |

**Workshop Bookings** (columns A–G)
| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Name | Email | Workshop Date | Style | Status | Helcim Payment ID | Created At |

Service account setup:
1. Google Cloud Console → new project
2. Enable Google Sheets API
3. Create a service account, download JSON key
4. Share the Google Sheet with the service account email (Editor)
5. Paste `client_email` and `private_key` from JSON into env vars

---

## Resend Setup

1. Sign up at resend.com
2. Add and verify your domain (DNS TXT record)
3. Create an API key
4. Sending address must use the verified domain (e.g. `hello@flowerscan.ca`)

---

## DNS Setup (Namecheap → Vercel)

```
Type    Host    Value
A       @       76.76.21.21          ← Vercel's IP
CNAME   www     cname.vercel-dns.com ← or the specific DNS string Vercel gives you
```

After adding DNS records, add the custom domain in the Vercel project dashboard. Vercel handles SSL automatically.

---

## Deploying

```bash
npm install           # installs googleapis, resend, axios for API functions
vercel --prod --yes   # deploys to production
```

Vercel detects the `/api` directory and deploys each `.js` file as a serverless function automatically. No configuration needed beyond `vercel.json` routing.

---

## Design System Summary

All styles live in `css/style.css` using CSS custom properties.

```css
--color-bg:      #F5F0EA   /* warm off-white */
--color-text:    #2C2C2C   /* near-black */
--color-accent:  #8B7355   /* warm brown */
--color-muted:   #9E9E8F   /* grey-green */
--color-border:  #DDD8CF   /* light warm grey */

--font-display:  'Cormorant Garamond', Georgia, serif
--font-body:     'Inter', system-ui, sans-serif
```

Fonts loaded from Google Fonts via `<link rel="preconnect">` in each HTML file's `<head>`.

Button variants: `.btn--primary` (filled), `.btn--secondary` (outline), `.btn--muted` (ghost), `.btn--sm` (small).

Images use `filter: saturate(0.75)` for a muted, editorial feel. No box shadows, no border-radius on containers, no gradient overlays.

---

## JS Features (main.js)

Three self-contained modules inside an IIFE:

1. **Hero phrase animation** — cycles "flowerscan" → "flower scan" → "flowers can" via opacity transitions. Pure CSS transition, JS handles timing only.
2. **FAQ accordion** — toggles `.is-open` class, one item open at a time, keyboard accessible via `aria-expanded`.
3. **Helcim checkout** — any button with `data-checkout-type` triggers the full payment flow. Workshop buttons also carry `data-workshop-date`.

---

## What to change for a new client

- Replace brand name, colors, fonts in `style.css`
- Replace copy in all HTML files
- Update `YOUR_DOMAIN` env var
- Update CORS allowlist in both API files
- Update email templates in `webhook.js` (`subscriptionEmailHtml`, `workshopEmailHtml`)
- Update Google Sheet column headers to match new business logic
- Update pricing env vars
- Add/remove pages as needed (gallery, workshops are optional)
- Point a new domain in Vercel + update DNS at the registrar
