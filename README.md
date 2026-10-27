# Repair Hub: Mobile Repair & Delivery Platform (Angular)

**Live demo: https://repair-hub-beta.vercel.app**. Sign in with any demo account; the password is `Demo@1234`.

| Role | Email |
|---|---|
| Super admin | `admin@repairhub.pk` |
| Operations staff | `ops@repairhub.pk` |
| Vendor (repair shop) | `fixit@repairhub.pk` · `techcare@repairhub.pk` |
| Customer | `sara@example.pk` |
| Delivery agent | `rider@repairhub.pk` |

A multi-vendor phone repair marketplace for Pakistan. Customers request a repair, and verified shops near them accept it. The phone is collected with a code-verified handover, inspected and quoted. The customer approves the quote, and the phone is repaired, delivered back and paid for. Admins manage vendors, assignments, payments, commissions, settlements, disputes and reports. Prices are in PKR, phone numbers use Pakistani formats, and all dates are Asia/Karachi.

Built with **Angular 22**, **Angular Material (M3)**, signals and `resource()`, zoneless change detection, **Zod** and **Chart.js**.

> **How the backend works in this build.** The portfolio is a static site, so the backend
> (`src/app/core/backend.ts`) runs in the browser and stores data in `localStorage`. It is
> written like a server: callers send only a session token; every call re-reads the data,
> checks role, permission and record access, validates input, and commits atomically. All
> status changes go through a state machine. It loads as a lazy chunk behind an async API,
> so moving it to Next.js/NestJS + PostgreSQL (`prisma/schema.prisma`) doesn't touch the UI.
> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Features

**Customers**
- Three-step repair request: phone and problem with photos, pickup and delivery address with a time window, then review with diagnostic-fee consent.
- Live tracking with a 7-stage progress bar and a full status timeline.
- One-time **handover codes** for pickup and delivery. They are shown only to the customer and stored hashed, with an expiry and an attempt limit.
- Approve or reject **itemised quotations**. Revised quotes for extra damage need approval again, and earlier versions are kept.
- Pay cash on delivery or report a bank transfer for staff to confirm. Printable receipts, warranty details, one review per job, disputes and support threads.
- Phone verification, saved addresses, password change and account deletion (anonymises personal data).

**Repair shops (vendors)**
- Registration with documents, service areas, specialties, brands and IBAN. Admin approval is required before taking jobs.
- **Marketplace** of eligible jobs (area, brand, specialty, availability). The customer's identity and address stay hidden until the shop accepts.
- **Race-safe acceptance**: if two shops click Accept, only one gets the job and the other sees "already taken".
- Job workspace: schedule pickup (self or delivery agent), a condition report with optional IMEI, an inspection, quotations with a live commission and net-earnings preview, parts used, before/after photos, delay notices, QC, delivery, cash collection and close.
- Dashboard with performance figures calculated from real jobs, plus earnings, settlements, reviews and business settings.

**Delivery agents**: assigned pickups and deliveries, code verification, cash on delivery.

**Admins and staff** (granular permissions; staff never become super admins)
- Overview KPIs: live queues, period totals, and money figures kept separate (gross value, collected, commission, refunds, outstanding, vendor payables).
- Job search, filters, sorting, pagination and CSV export. Assign or reassign vendors with an eligibility breakdown, publish, cancel, confirm transfers, refund and resolve disputes.
- Two **assignment modes** (first eligible vendor accepts, or admin assigns with an acceptance timeout).
- **Append-only ledger** with idempotency keys, transfer verification, a signed payment-gateway webhook handler (duplicate events ignored), refunds and vendor settlements.
- **Reports**: turnaround times, jobs by status, category, brand, model, area and vendor, vendor performance, cancellation reasons, repeat-customer rate, ratings, revenue by day, week, month or year, payments by method, charges by category, earnings and settlements, and outstanding balances. Each section has a chart, a table view and CSV export, and the page can be printed or saved as PDF.
- Vendor approvals, customer management, catalogue, staff and permissions, settings, review moderation and the audit log.
- Notification service: every event is an in-app notification. Email and SMS attempts are logged as *provider not configured*, so nothing pretends a message was sent.

## Run it

```bash
npm install
npm start          # http://localhost:4200
npm test           # 85 unit and integration tests (Vitest)
npm run build      # production build → dist/repair-hub/browser
npm run e2e        # Playwright lifecycle run against a served build (see docs/DEPLOYMENT.md)
```

"Reset demo data" in the top banner restores the seeded data. Demo records are generated by running the **real workflow** with a simulated clock, so their histories, ledgers and balances are consistent.

## Tests

- `core/backend.spec.ts` (integration): registration, lockout, phone verification, vendor approval, marketplace redaction, **concurrent acceptance** (including two tabs sharing storage), admin-assign with expiry, invalid transitions, version conflicts, cancellation policy, hashed OTPs (wrong, expired, regenerated), IMEI masking, failed pickup and reschedule, quotation approval, revised quotes, diagnostic-fee-only billing, duplicate payments and webhooks, transfer verification, frozen commission terms, balances and settlements, dispute refunds, customer and vendor isolation, staff privilege limits, file access, review rules and moderation, notifications, a full lifecycle, and the seed's consistency.
- `core/finance.spec.ts`, `workflow.spec.ts`, `reports.spec.ts`: money maths, the state machine, Karachi date boundaries, report consistency and CSV escaping.
- `e2e/lifecycle.mjs`: drives Chrome through the whole flow (request → accept → OTP pickup → quote → approve → repair → OTP delivery → payment → review → admin pages → access check → mobile overflow).

## Project structure

```
src/app/
  core/          models, backend (server logic), workflow (state machine), finance, reports,
                 schemas (Zod), crypto, db, seed, api (client), session, theme
  layout/        app shell (role-based sidenav, notifications), demo banner
  shared/        status badges, KPI tiles, pipes, dialogs, uploads, charts
  features/
    public/      landing, sign in, customer and vendor registration
    customer/    my repairs, request wizard, payments, profile
    vendor/      dashboard, marketplace, jobs, tasks (also agents and admin), earnings, reviews, settings
    jobs/        shared job detail (role-aware actions), quotation and handover forms, receipt
    support/     complaints and disputes
    admin/       overview, jobs, vendors, customers, finance, reports, support, catalogue, staff, settings, audit
docs/            ARCHITECTURE (data model, state diagram, rules), API, GUIDE, DEPLOYMENT
prisma/          target PostgreSQL schema for a server deployment
```

## Integrations still required for production

SMTP or SendGrid (email), an SMS gateway, the WhatsApp Business API, an online payment gateway, S3-compatible private storage, PostgreSQL, Redis (rate limits), and Sentry. See [.env.example](.env.example) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Known limitations of the portfolio build

- Data lives in each visitor's browser (about 5 MB). Two tabs stay in sync, but different browsers don't share data.
- Because the "server" runs client-side, a determined user could edit `localStorage`. The access rules are real and tested, but only a server deployment makes them a security boundary.
- Passwords use stretched, salted SHA-256 so hashing can stay synchronous. Use argon2id on a server.
- With no SMS provider, phone verification codes are shown in-app and labelled as such.
- There is no live GPS tracking; the data model reserves fields for it.
- Online payments are disabled until a gateway is configured. The signed webhook handler is implemented and tested.
- PDF export uses the browser's print-to-PDF.
