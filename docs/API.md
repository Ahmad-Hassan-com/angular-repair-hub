# API reference

Every endpoint is a method on `Backend` (`src/app/core/backend.ts`). Authenticated
endpoints take the session `token` as their first argument. The backend resolves the user,
checks role, permission and record access, validates input with Zod, and runs the whole call
as one transaction. Errors are `ApiError` with a `code`:

| Code | Meaning | HTTP equivalent |
|---|---|---|
| `UNAUTHENTICATED` | no/expired session | 401 |
| `FORBIDDEN` | role or permission missing | 403 |
| `NOT_FOUND` | record missing **or not yours** (no existence leak) | 404 |
| `VALIDATION` | bad input | 422 |
| `CONFLICT` | invalid transition, stale version, already taken | 409 |
| `RATE_LIMITED` | too many attempts | 429 |
| `UNAVAILABLE` | integration not configured | 503 |

In a server build these map one-to-one to routes, e.g. `POST /api/jobs/:id/accept` → `acceptJob`.

## Auth and profile

| Method | Who | Notes |
|---|---|---|
| `login(email, password)` | anyone | Rate limited at 10 per 15 min per email. Locks for 15 min after 5 failures. Returns `{ token, user }`. |
| `logout(token)` | signed in | Deletes the session. |
| `me(token)` | signed in | User, plus vendor profile or saved addresses. |
| `registerCustomer(input)` | anyone | Name, email, PK mobile, password (8+ chars, letters and numbers). |
| `registerVendor(input)` | anyone | Shop, owner, address, areas, specialties, brands, documents, optional IBAN, terms. The account starts `PENDING`. |
| `requestPhoneCode(token)` / `verifyPhone(token, code)` | signed in | Hashed 6-digit code, 10-minute expiry. With no SMS provider, the code is returned to the owner as `demoCode`. |
| `updateProfile(token, {name, phone, addresses})` | signed in | Changing the phone clears verification. |
| `changePassword(token, current, next)` | signed in | Signs out other sessions. |
| `deleteAccount(token)` | customer | Anonymises the account. Refused while repairs are in progress. |

## Catalogue and files

| Method | Who | Notes |
|---|---|---|
| `catalog()` | anyone | Active brands, models, categories, areas. |
| `adminCatalog(token)` / `upsertCatalog(token, table, item)` | `catalog.manage` | Includes inactive entries. Names must be unique. |
| `uploadFile(token \| null, {dataUrl, mime, size})` | signed in (anonymous only for vendor sign-up) | JPEG, PNG, WebP or PDF, up to 1.5 MB. The content prefix must match the type. |
| `file(token, id)` | owner, job parties, staff | Access-checked read. |

## Jobs

| Method | Who | Notes |
|---|---|---|
| `createRequest(token, input)` | customer | Validates the model belongs to the brand, the area is served and the date isn't past. Publishes or queues the job depending on the mode. |
| `listJobs(token, query)` | any role (scoped) | Search, status (`ACTIVE`, `OVERDUE`, or a status), vendor, area, date, sort, pagination. |
| `getJob(token, id)` | parties and staff | The full `JobView`. Eligible vendors get a `LIMITED` preview with no customer identity, street address or photos. |
| `cancelJob(token, id, reason)` | customer (by policy) or `jobs.cancel` | |
| `marketplace(token)` | approved vendor | Eligible open jobs and offers made to this vendor. |
| `acceptJob(token, id, expectedVersion?)` | approved vendor | **Atomic.** A second vendor gets `CONFLICT`: "already been taken". |
| `declineOffer(token, id, reason)` | offered vendor | |
| `assignVendor(token, id, vendorId, note)` / `publishJob(token, id)` | `jobs.assign` | Offer with a timeout, reassign, or publish. |
| `candidateVendors(token, id)` | `jobs.assign` | Eligibility breakdown for the assignment dialog. |
| `advance(token, id, to, note, fileIds, expectedVersion?)` | per transition table | Plain transitions only. Some need a note. |
| `schedulePickup(token, id, schedule)` / `scheduleDelivery(...)` | vendor, `deliveries.manage` | Creates a task. The assignee is the shop or an active agent. |
| `generateHandoverCode(token, id)` | job's customer | 6 digits, shown once and stored hashed. 30-minute expiry, 5 attempts (configurable). |
| `confirmCollection(token, id, otp, condition)` | task assignee | Verifies the OTP and records the condition report (optional IMEI and photos). |
| `submitQuotation(token, id, input)` | job's vendor | Records the inspection and creates a new version. Earlier pending versions are superseded. Freezes the commission terms. |
| `respondToQuotation(token, id, quotationId, approve, note)` | job's customer | Rejecting requires a reason and stops the repair. |
| `markUnrepairable(token, id, findings)` | job's vendor | |
| `addPart`, `addWorkLog` | job's vendor | Parts used; notes with before/after/delay photos (delay notes notify the customer). |
| `confirmDelivery(token, id, otp, note, fileIds)` | task assignee | Issues the invoice, starts the warranty, and settles if paid. |
| `closeJob(token, id, note)` | vendor (when paid), staff | Disputes need a resolution note. |
| `myTasks(token)` / `allTasks(token)` | agent or vendor / `deliveries.manage` | |

## Money

| Method | Who | Notes |
|---|---|---|
| `recordPayment(token, id, {method, amount, reference, idempotencyKey})` | vendor, agent, `payments.verify` | No overpayment. `ONLINE` is refused because only the gateway confirms online payments. Replays return the original entry. |
| `reportTransfer(token, id, {...})` | customer | Stays `PENDING_VERIFICATION` until staff confirm it. |
| `verifyTransfer(token, txId)` | `payments.verify` | |
| `gatewayWebhook({eventId, jobId, amount, signature})` | payment gateway | SHA-256 signature with a server secret. Duplicate events return `DUPLICATE`. |
| `issueRefund(token, id, {amount, reason, collector, idempotencyKey})` | `refunds.issue` | A full refund of a disputed job sets it to `REFUNDED`. |
| `vendorBalances(token)` / `createSettlement(token, vendorId, amount, ref)` / `settlements(token)` | `settlements.manage` (vendors see their own settlements) | |
| `ledger(token)` | `payments.verify` | |

## Support, notifications and admin

| Method | Who |
|---|---|
| `raiseComplaint`, `listComplaints`, `replyToComplaint` | customers and vendors (own), `complaints.manage` |
| `addReview` / `allReviews`, `moderateReview` | customer / `reviews.moderate` |
| `notifications`, `markNotificationsRead` | signed in |
| `deliveryLog` | `settings.manage` |
| `listVendors`, `setVendorStatus` | `vendors.manage` |
| `listUsers`, `setUserStatus` | `customers.manage` / `staff.manage` |
| `createStaff`, `setPermissions` | `staff.manage` (you can't grant permissions you don't hold) |
| `settings`, `updateSettings` | read: signed in; write: `settings.manage` |
| `auditLog` | `audit.view` |
| `reportData` | `reports.view` |
| `vendorDashboard`, `updateVendorProfile` | vendor |
