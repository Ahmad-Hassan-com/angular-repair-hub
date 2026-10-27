# Deployment

## The portfolio build (static, as deployed)

```bash
npm ci
npm test          # unit and integration tests (Vitest)
npm run build     # dist/repair-hub/browser
```

`vercel.json` builds with `npm run build`, serves `dist/repair-hub/browser`, and rewrites
every path to `index.html` for client-side routing. Node 24 is pinned in `package.json`.
No environment variables are needed: data lives in each visitor's browser and is seeded on
first visit.

End-to-end check against any running build:

```bash
npx serve -s dist/repair-hub/browser -l 4200    # any static server with SPA fallback works
E2E_URL=http://localhost:4200 CHROME_PATH="/path/to/chrome" npm run e2e
```

## Moving to a production server

The browser backend is shaped for this move. Suggested path:

1. **Database**: provision PostgreSQL 16 and set `DATABASE_URL`. Apply `prisma/schema.prisma` with `npx prisma migrate deploy` (generate the initial migration with `prisma migrate dev --name init` in development).
2. **API**: move each `Backend` method into a route handler (Next.js `app/api/...` or NestJS). Replace `this.tx(fn)` with `prisma.$transaction(fn, { isolationLevel: 'Serializable' })`. For job acceptance, use a conditional update: `UPDATE repair_job SET vendor_id=$1, status='VENDOR_ACCEPTED', version=version+1 WHERE id=$2 AND status='AWAITING_VENDOR' AND vendor_id IS NULL`. Zero rows updated means the job was already taken.
3. **Sessions**: issue the token in an `HttpOnly; Secure; SameSite=Lax` cookie instead of `localStorage`. Add CSRF tokens on state-changing routes. Keep storing only the token hash.
4. **Passwords**: switch `hashSecret` to argon2id for passwords. Keep salted SHA-256 for short-lived OTPs, or use HMAC with a server key.
5. **Rate limiting**: move the counters to Redis (`RATE_LIMIT_REDIS_URL`).
6. **Files**: upload directly to S3-compatible storage with presigned URLs. Keep vendor documents and device photos in a **private** bucket. Validate type by magic bytes, and serve through short-lived signed URLs after the same access check as `file()`.
7. **Notifications**: implement the `EMAIL`, `SMS` and `WHATSAPP` channels behind the existing `notify()` call (SendGrid/SMTP, a Pakistani SMS gateway, the WhatsApp Business API). Keep logging `PROVIDER_NOT_CONFIGURED` when credentials are absent.
8. **Payments**: integrate the card or wallet gateway and point its webhook at `gatewayWebhook`. Signature checks and idempotency are already implemented.
9. **Observability**: send structured logs (JSON) and errors to Sentry or similar. Keep `AuditLog` in the database.
10. **Demo data**: run the seed only when `SEED_DEMO_DATA=true` and never in production. All seeded rows carry `demo: true`.

## Backups and recovery

- Enable managed PostgreSQL point-in-time recovery (7–30 days), plus nightly logical dumps (`pg_dump -Fc`) copied to a separate account or region.
- Version the S3 bucket and replicate it across regions.
- Test a restore every quarter: restore into staging, run `prisma migrate status`, and run the e2e suite.
- Recovery targets for launch: RPO 15 minutes (WAL/PITR), RTO 4 hours.
- The ledger and audit log are append-only, so never "fix" data by editing rows. Post a correcting entry instead.

## Data retention

- Customer account deletion anonymises personal data immediately. Jobs, invoices and the ledger are kept for 6 years for tax purposes.
- Device photos and condition evidence: delete 12 months after the job closes, unless the job is in dispute.
- Vendor documents: keep while the vendor is active, then for 2 years.
- Sessions expire after 7 days; OTPs after 30 minutes (configurable).
