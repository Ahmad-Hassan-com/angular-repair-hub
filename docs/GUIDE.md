# Usage guide

Sign in from `/login` with any demo account. The password for all of them is `Demo@1234`.

| Account | Role |
|---|---|
| `admin@repairhub.pk` | Super admin |
| `ops@repairhub.pk` | Operations staff (jobs, deliveries, complaints, payments, reports) |
| `fixit@repairhub.pk` | Vendor: FixIt Mobile Lab (all Lahore areas, all brands) |
| `techcare@repairhub.pk` | Vendor: TechCare Repairs (part of Lahore, five brands) |
| `quickfix@repairhub.pk` | Vendor: application pending approval |
| `sara@example.pk` | Customer with a quotation waiting for approval |
| `rider@repairhub.pk` | Delivery agent |

"Reset demo data" in the top banner restores the original data.

## Customers

1. **Request a repair**: choose the phone and problem, describe it, and add photos. Then enter the pickup address and a time window, and decide whether to agree to the diagnostic fee.
2. **Track it** on *My repairs*. Jobs that need you appear under *Needs your attention*.
3. **Handover code**: when a courier arrives for pickup or delivery, open the job and press *Show handover code*. Read the code out to the courier; don't share it earlier.
4. **Quotation**: approve or reject it. No repair work can start before you approve. If the shop finds more damage, you'll be asked to approve a revised quote.
5. **Pay**: pay the courier or shop in cash, or report a bank transfer for staff to confirm. Receipts are under *Payments & receipts*.
6. **After delivery**: leave a review (once per job). If something is wrong, raise a dispute from the job page.

## Vendors

1. **Register** at `/register/vendor`. You can sign in straight away, but you can't take jobs until an admin approves you.
2. **Available jobs** lists requests in your areas for your brands and repair types. You see the area and device only; the customer's details appear after you accept. If another shop accepts first, you'll get a clear message.
3. **Job workspace**: the *Next step* panel always shows what's due:
   - schedule the pickup, and choose yourself or a delivery agent;
   - start the pickup, then enter the customer's code and record the phone's condition (IMEI optional; never ask for passcodes);
   - received at shop → start inspection → send an itemised quotation. You can see your commission and net earnings before sending it;
   - after approval: start the repair, record parts and before/after photos, mark *waiting for parts* (the customer is told), or send a revised quote;
   - repair completed → quality check → schedule delivery → out for delivery → enter the customer's code;
   - record cash you collected, then close the job once it's paid.
4. **Earnings** shows earnings on paid jobs, commission, the cash you hold, settlements, and your balance with the platform.
5. **Business settings**: availability, areas, specialties, brands and working hours.

## Delivery agents

*My tasks* lists your assigned pickups and deliveries. Open one to start it and verify the
customer's code. Cash you collect on delivery is recorded as held by the platform.

## Administrators and staff

- **Overview**: live queues (awaiting vendor, delayed, pending approvals and vendor applications) and figures for the selected period.
- **Repair jobs**: search, filter, sort and export. Open a job to assign or reassign a vendor, publish it, cancel it, confirm transfers, refund, or resolve a dispute.
- **Pickup & delivery**: every courier visit, including failed ones.
- **Vendors**: review documents and approve, reject (with a reason), suspend or reactivate.
- **Payments & settlements**: confirm customer transfers, browse and export the ledger, and record vendor payouts or commission collections.
- **Reports**: operational and financial reports with date presets or a custom range, CSV per section, and print/PDF.
- **Complaints & reviews**: reply to and resolve complaints. Hide abusive reviews with a policy reason.
- **Catalogue**, **Staff & permissions** (granular, never super-admin), **Settings** (assignment mode, commission, fees, OTP rules, payment methods, integrations status), **Audit log**.

### Review moderation policy

Hide a review only if it contains abuse or personal data, or is unrelated to the repair.
Always record the reason. Ratings and text are never edited.
