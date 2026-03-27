# JustAgro Backend

Express + TypeScript REST API for the JustAgro agricultural payment platform. Handles authentication, inventory, transactions, Interswitch payment processing, Termii notifications, and Google Gemini AI features.

**Live API:** https://justagro-backend.onrender.com  
**API Docs:** https://justagro-backend.onrender.com/api-docs  
**Frontend:** https://justagro.vercel.app
**Bug Docs:** [Bug Tracker](https://onedrive.live.com/:x:/g/personal/b0ece33bc7faaa4f/IQDpaDvyI59XS6AaBZ1eLs0GAXg0uUWQrXTGgZCFTWlee9Y?rtime=LvTQtzWM3kg&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy9iMGVjZTMzYmM3ZmFhYTRmL0lRRHBhRHZ5STU5WFM2QWFCWjFlTHMwR0FYZzB1VVdRclhUR2daQ0ZUV2xlZTlZ)
---

## Prerequisites

- Node.js 18+
- yarn
- PostgreSQL database (Neon recommended)
- Interswitch merchant account (business.quickteller.com)
- Termii account for SMS/WhatsApp
- Google Gemini API key (free tier)

---

## Local Setup

```bash
git clone https://github.com/TeamGreenRoots/justagro-backend
cd justagro-backend

yarn install

cp .env.example .env
# Fill in all required env vars (see below)

yarn db:generate   # generate Prisma client
yarn db:push       # push schema to database
yarn db:seed       # seed demo accounts (optional)

yarn dev           # starts on :5000
```

---

## Environment Variables

```env
# Server
PORT=5000
NODE_ENV=development

# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require

# Auth
JWT_SECRET=your_jwt_secret_min_32_chars
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars

# Interswitch
INTERSWITCH_CLIENT_ID=IKIA...
INTERSWITCH_CLIENT_SECRET=...
INTERSWITCH_MERCHANT_CODE=MX...
INTERSWITCH_PAY_ITEM_ID=Default_Payable_MX...
INTERSWITCH_BASE_URL=https://sandbox.interswitchng.com
INTERSWITCH_CHECKOUT_SCRIPT_URL=https://newwebpay.interswitchng.com/inline-checkout.js
WALLET_ID=your_wallet_id
WALLET_PIN=your_wallet_pin

# Termii (SMS + WhatsApp)
TERMII_API_KEY=TL...
TERMII_SENDER_ID=JustAgro
TEST_WHATSAPP_NUMBER=234xxxxxxxxxx

# Google Gemini AI
GEMINI_API_KEY=AIza...

# Render keep-alive
RENDER_EXTERNAL_URL=https://justagro-backend.onrender.com
```

---

## Scripts

```bash
yarn dev           # tsx watch — hot reload
yarn build         # tsc → dist/
yarn start         # node dist/server.js
yarn db:generate   # prisma generate
yarn db:push       # prisma db push
yarn db:migrate    # prisma migrate dev
yarn db:seed       # seed demo data
yarn db:studio     # open Prisma Studio
```

---

## Tech Stack

| Layer | Library |
|---|---|
| Runtime | Node.js 18 |
| Framework | Express 4 |
| Language | TypeScript 5 |
| ORM | Prisma 5 |
| Database | PostgreSQL (Neon) |
| Auth | JWT (jsonwebtoken) |
| Payments | Interswitch Inline Checkout + Payouts API |
| Notifications | Termii (SMS + WhatsApp) |
| AI | Google Gemini 1.5 Flash |
| Docs | Swagger / OpenAPI |
| Deploy | Render (free tier) |

---

## Architecture

### Module Structure

```
src/
  app.ts                     Express app setup, CORS, all routes registered
  server.ts                  HTTP server + keep-alive ping (Render free tier)
  lib/
    prisma.ts                Singleton Prisma client
    interswitch.ts           Payment initiation + server-side verify
    notifications.ts         Termii SMS + WhatsApp wrapper
    gemini.ts                Gemini API wrapper with JSON parsing + fallback
  modules/
    auth/                    JWT login, register, refresh token
    farmer/                  Farmer CRUD, dashboard, wallet, withdrawals
    buyer/                   Buyer CRUD
    aggregator/              Aggregator dashboard, stats
    inventory/               Inventory lifecycle (AVAILABLE → RESERVED → SOLD)
    transactions/            Full transaction flow including public pay/verify
    buyer-contacts/          Manual buyer contact management
    notifications/           In-app notification CRUD
    ai/                      Gemini endpoints (fraud, market, advice, price)
```

### Authentication

JWT access token (7 days) + refresh token (30 days) stored as cookies on the client. Every protected route uses `authenticate` middleware which reads `Authorization: Bearer <token>`, verifies the JWT, and attaches `req.user`.

Role-based access: `FARMER`, `BUYER`, `AGGREGATOR`. Role is encoded in the JWT payload. Route middleware checks role using `requireRole(["AGGREGATOR"])`.

### Transaction Flow

```
1. POST /api/v1/transactions
   Aggregator creates transaction → inventory status → RESERVED
   → Termii WhatsApp + SMS sent to buyer with payment link

2. GET /api/v1/transactions/public/:txnRef
   Public endpoint (no auth) → returns payment config for Interswitch checkout

3. POST /api/v1/transactions/public/:txnRef/verify
   Called after Interswitch onComplete fires with responseCode "00"
   → Backend calls Interswitch gettransaction.json independently
   → Only marks PAID if server confirms responseCode "00" + amount matches
   → Farmer wallet credited (99%), platform fee retained (1%)
   → Termii notifications fired to farmer + buyer

4. POST /api/v1/transactions/:id/assist
   Aggregator marks as paid (for cash/offline payments)
   → Same wallet + notification flow
```

### Interswitch Integration

**Payment (Inline Checkout):**
- Client loads `inline-checkout.js` from `INTERSWITCH_CHECKOUT_SCRIPT_URL`
- `window.webpayCheckout(config)` opens the payment popup
- `onComplete` fires — responseCode "00" means success on the client
- Client calls `/verify` → backend calls Interswitch `gettransaction.json` to confirm independently
- Never trust the client callback alone

**Withdrawal (Payouts API):**
- `POST /api/v1/farmer/withdraw` 
- Calls Interswitch Payouts `POST /api/v1/payouts` with `singleCall: true`
- Channel: `BANK_TRANSFER`
- Requires `WALLET_ID` and `WALLET_PIN` from business.quickteller.com

**Sandbox test payout account:**
Account number: `0037320662` / Bank code: `TRP`

**Sandbox test cards:**

| Card | Number | Expiry | CVV | PIN | OTP |
|---|---|---|---|---|---|
| Verve (recommended) | 5061050254756707864 | 06/26 | 111 | 1111 | none |
| Visa | 4000000000002503 | 03/50 | 11 | 1111 | none |
| Mastercard | 5123450000000008 | 01/39 | 100 | 1111 | 123456 |

> **Z4 error:** Interswitch Starter accounts have a per-transaction sandbox limit (~₦2,000). Create transactions with small amounts for testing, or upgrade account type at business.quickteller.com.

### AI Endpoints (Google Gemini 1.5 Flash)

All endpoints prompt Gemini to respond in JSON only, strip markdown fences, parse, and return. Every endpoint has a hardcoded fallback — AI failure never breaks the UI.

| Endpoint | Auth | Inputs | Returns |
|---|---|---|---|
| `GET /ai/farmer-advice` | FARMER | wallet, transactions, inventory | greeting, encouragement, topAdvice[], performance |
| `GET /ai/market-summary` | AGGREGATOR | grouped inventory by crop | headline, topDemand[], priceAlert, tip, sentiment |
| `GET /ai/fraud-check/:id` | AGGREGATOR | transaction + farmer history | riskLevel, flags[], recommendation |
| `GET /ai/price-intelligence/:id` | ALL | crop, price, quantity, location | marketPrice, percentageDiff, status, advice |

### Notifications

Every payment event triggers three simultaneous notifications:

1. In-app — saved to `Notification` table, fetched by frontend via 10-second polling
2. SMS — Termii `messaging` API
3. WhatsApp — Termii `messaging` API with `channel: "whatsapp"`

During development, all WhatsApp messages are routed to `TEST_WHATSAPP_NUMBER` with the real recipient prefixed in the message body. Remove this override in production.

---

## API Reference

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | None | Register new user |
| POST | `/api/v1/auth/login` | None | Login, returns JWT |
| POST | `/api/v1/auth/refresh` | None | Refresh access token |
| GET | `/api/v1/auth/me` | JWT | Get current user |

### Farmer

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/farmers` | AGGREGATOR | List all farmers (paginated, searchable) |
| GET | `/api/v1/farmers/:id` | AGGREGATOR | Farmer detail with inventory + transactions |
| GET | `/api/v1/farmer/dashboard/me` | FARMER | Own dashboard data |
| POST | `/api/v1/farmer/withdraw` | FARMER | Withdraw to bank via Interswitch Payouts |

### Inventory

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/inventory/browse` | None | Public — all AVAILABLE items |
| GET | `/api/v1/inventory` | JWT | Filtered inventory list |
| POST | `/api/v1/inventory` | AGGREGATOR | Add stock for a farmer |
| PUT | `/api/v1/inventory/:id` | AGGREGATOR | Update stock item |
| DELETE | `/api/v1/inventory/:id` | AGGREGATOR | Delete stock item |

### Transactions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/transactions` | JWT | List transactions (role-filtered) |
| POST | `/api/v1/transactions` | AGGREGATOR | Create transaction + notify buyer |
| GET | `/api/v1/transactions/public/:txnRef` | None | Get payment config for checkout |
| POST | `/api/v1/transactions/public/:txnRef/verify` | None | Server-side payment verification |
| POST | `/api/v1/transactions/:id/assist` | AGGREGATOR | Mark as paid (cash/offline) |
| POST | `/api/v1/transactions/:id/cancel` | AGGREGATOR | Cancel + release inventory |
| POST | `/api/v1/transactions/webhook` | None | Interswitch webhook handler |

### AI

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/ai/farmer-advice` | FARMER | Personalised AI farming advice |
| GET | `/api/v1/ai/market-summary` | AGGREGATOR | Daily AI market briefing |
| GET | `/api/v1/ai/fraud-check/:id` | AGGREGATOR | AI fraud risk assessment |
| GET | `/api/v1/ai/price-intelligence/:id` | JWT | Compare listed vs market price |

---

## Deployment (Render)

**Build command:**
```bash
yarn install && yarn db:generate && yarn build
```

**Start command:**
```bash
yarn start
```

**Environment variables:** Set all vars from `.env.example` in Render dashboard under Environment.

**Keep-alive:** `server.ts` pings `${RENDER_EXTERNAL_URL}/health` every 14 minutes to prevent the free tier from sleeping.

```bash
# Required env var on Render:
RENDER_EXTERNAL_URL=https://justagro-backend.onrender.com
```

---

## Known Issues and Workarounds

**Route ordering in Express**
`GET /:id` must always be defined after specific named routes like `GET /dashboard/me`. If a named route returns 404 or wrong data, check that parameterized routes are at the bottom of the router file.

**`@types/*` in devDependencies**
Render's build does not install `devDependencies`. All `@types/*` packages are in `dependencies`. `tsconfig.json` has `strict: false` and `skipLibCheck: true` to accommodate this.

**Interswitch Z4 sandbox limit**
Starter Business accounts have a per-transaction limit (~₦2,000 in sandbox). The frontend handles `Z4` explicitly with a user-facing explanation. Test with small amounts.

**WhatsApp test routing**
All WhatsApp notifications are currently routed to `TEST_WHATSAPP_NUMBER` in `.env`. Comment out the test routing in `notifications.ts` before production deployment.

**Gemini JSON parsing**
Gemini sometimes wraps JSON in markdown fences despite being instructed not to. `gemini.ts` strips ` ```json ` and ` ``` ` fences before parsing. All AI endpoints also have hardcoded fallback objects.

---

## Demo Accounts

Seed with `yarn db:seed` (password: `demo1234` for all):

| Role | Phone | Notes |
|---|---|---|
| Aggregator | 08000000001 | Full platform access, seeded transactions |
| Farmer | 08000000002 | Has inventory + paid transactions |
| Farmer (offline) | 08033221100 | Registered by aggregator, no smartphone |
| Farmer (new) | 08000000003 | No transactions, score = 0 |
| Buyer | 08000000004 | Has pending + paid orders |

Test payment link: `/pay/AGT_1717200000000_0003`

---

## Related

- [Frontend Repository](https://github.com/TeamGreenRoots/justagro-frontend)
- [Interswitch Docs](https://docs.interswitchgroup.com)
- [Termii Docs](https://developers.termii.com)
- [Gemini API](https://ai.google.dev)
- [Neon Postgres](https://neon.tech)
- [Render Deploy Docs](https://render.com/docs)

---

Built by TeamGreenRoots  
Interswitch | Enyata Hackathon 2026
