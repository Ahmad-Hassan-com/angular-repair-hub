import type { ReportData } from './backend';
import { jobFinancials, vendorBalance } from './finance';
import { JobStatus, PaymentMethod, RepairJob } from './models';
import { ACTIVE_STATUSES, COMPLETED_STATUSES, FINAL_STATUSES, REPAIR_STATUSES } from './workflow';

// Reporting maths. All date bucketing happens in Asia/Karachi (UTC+5, no DST), so a
// job created at 23:30 local time on the 3rd counts on the 3rd even though it is the
// 3rd at 18:30 UTC.
//
// Definitions used throughout (also shown in the UI):
//  - Job metrics count jobs CREATED in the range.
//  - Collected payments and refunds count ledger entries DATED in the range.
//  - Platform commission counts jobs whose money position became FINAL in the range.
//  - Gross repair value is the billable total of jobs created in the range.
//  - Outstanding and vendor balances are current positions, not ranged.

export const TIME_ZONE = 'Asia/Karachi';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD of an instant in Karachi. */
export function pkDay(iso: string | Date): string {
  return dayFormat.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export interface DateRange {
  /** Inclusive Karachi day, YYYY-MM-DD. */
  from: string;
  /** Inclusive Karachi day, YYYY-MM-DD. */
  to: string;
}

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'month' | 'year' | 'all';

export function presetRange(preset: RangePreset, now: Date): DateRange {
  const today = pkDay(now);
  const back = (days: number) => pkDay(new Date(now.getTime() - days * 86_400_000));
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: back(6), to: today };
    case '30d':
      return { from: back(29), to: today };
    case '90d':
      return { from: back(89), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'all':
      return { from: '2000-01-01', to: today };
  }
}

export const inRange = (iso: string, r: DateRange) => {
  const d = pkDay(iso);
  return d >= r.from && d <= r.to;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

function firstAt(data: ReportData, jobId: string, to: JobStatus): string | undefined {
  return data.history.find((h) => h.jobId === jobId && h.to === to)?.at;
}

function lastAt(data: ReportData, jobId: string, to: JobStatus): string | undefined {
  let at: string | undefined;
  for (const h of data.history) if (h.jobId === jobId && h.to === to) at = h.at;
  return at;
}

/** When the job's money position became final (first entry into a final status). */
function finalAt(data: ReportData, job: RepairJob): string | undefined {
  if (!FINAL_STATUSES.includes(job.status)) return undefined;
  return data.history.find((h) => h.jobId === job.id && FINAL_STATUSES.includes(h.to))?.at;
}

export function isOverdue(job: RepairJob, now: string): boolean {
  return (
    !!job.promisedAt &&
    job.promisedAt < now &&
    ACTIVE_STATUSES.includes(job.status) &&
    !['DELIVERED', 'DISPUTED', 'CANCELLED'].includes(job.status)
  );
}

export interface Kpis {
  totalRequests: number;
  newToday: number;
  awaitingVendor: number;
  activeRepairs: number;
  pendingApprovals: number;
  delayed: number;
  completed: number;
  cancelled: number;
  unrepairable: number;
  totalCustomers: number;
  totalVendors: number;
  pendingVendors: number;
  collected: number;
  outstanding: number;
  grossValue: number;
  commission: number;
  vendorPayable: number;
  refunds: number;
}

export function computeKpis(data: ReportData, range: DateRange): Kpis {
  const today = pkDay(data.now);
  const ranged = data.jobs.filter((j) => inRange(j.createdAt, range));
  const tx = data.transactions.filter((t) => t.status === 'CONFIRMED' && inRange(t.at, range));
  let outstanding = 0;
  for (const j of data.jobs) {
    if (j.status === 'CANCELLED') continue;
    // Money is only due once the phone is back with the customer.
    if (
      ['DELIVERED', 'RETURNED_WITHOUT_REPAIR', 'DISPUTED'].includes(j.status) ||
      FINAL_STATUSES.includes(j.status)
    ) {
      outstanding += jobFinancials(j, data.quotations, data.transactions).outstanding;
    }
  }
  const commission = data.jobs
    .filter((j) => {
      const at = finalAt(data, j);
      return at && inRange(at, range);
    })
    .reduce((s, j) => s + jobFinancials(j, data.quotations, data.transactions).commission, 0);
  const vendorPayable = data.vendors
    .map(
      (v) =>
        vendorBalance(v.id, data.jobs, data.quotations, data.transactions, data.settlements)
          .balance,
    )
    .filter((b) => b > 0)
    .reduce((a, b) => a + b, 0);
  return {
    totalRequests: ranged.length,
    newToday: data.jobs.filter((j) => pkDay(j.createdAt) === today).length,
    awaitingVendor: data.jobs.filter(
      (j) => j.status === 'SUBMITTED' || j.status === 'AWAITING_VENDOR',
    ).length,
    activeRepairs: data.jobs.filter((j) => REPAIR_STATUSES.includes(j.status)).length,
    pendingApprovals: data.jobs.filter((j) => j.status === 'AWAITING_APPROVAL').length,
    delayed: data.jobs.filter((j) => isOverdue(j, data.now)).length,
    completed: ranged.filter((j) => COMPLETED_STATUSES.includes(j.status)).length,
    cancelled: ranged.filter((j) => j.status === 'CANCELLED').length,
    unrepairable: ranged.filter((j) =>
      data.history.some((h) => h.jobId === j.id && h.to === 'UNREPAIRABLE'),
    ).length,
    totalCustomers: data.customers.length,
    totalVendors: data.vendors.filter((v) => v.status === 'APPROVED').length,
    pendingVendors: data.vendors.filter((v) => v.status === 'PENDING').length,
    collected: tx.filter((t) => t.kind === 'PAYMENT').reduce((s, t) => s + t.amount, 0),
    outstanding,
    grossValue: ranged.reduce(
      (s, j) => s + jobFinancials(j, data.quotations, data.transactions).total,
      0,
    ),
    commission,
    vendorPayable,
    refunds: tx.filter((t) => t.kind === 'REFUND').reduce((s, t) => s + t.amount, 0),
  };
}

export interface CountRow {
  key: string;
  label: string;
  count: number;
  value?: number;
}

function countBy(
  jobs: RepairJob[],
  key: (j: RepairJob) => string,
  label: (k: string) => string,
  value?: (j: RepairJob) => number,
): CountRow[] {
  const map = new Map<string, CountRow>();
  for (const j of jobs) {
    const k = key(j);
    const row = map.get(k) ?? { key: k, label: label(k), count: 0, value: value ? 0 : undefined };
    row.count += 1;
    if (value) row.value! += value(j);
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function operationalReport(data: ReportData, range: DateRange) {
  const jobs = data.jobs.filter((j) => inRange(j.createdAt, range));
  const name = (rows: { id: string; name: string }[]) => (id: string) =>
    rows.find((r) => r.id === id)?.name ?? '—';
  const brand = name(data.brands);
  const model = name(data.models);
  const shop = (id: string) => data.vendors.find((v) => v.id === id)?.shopName ?? 'Unassigned';
  const value = (j: RepairJob) => jobFinancials(j, data.quotations, data.transactions).total;

  const durations = (from: JobStatus, to: JobStatus, first = true) =>
    avg(
      jobs
        .map((j) => {
          const a = firstAt(data, j.id, from);
          const b = first ? firstAt(data, j.id, to) : lastAt(data, j.id, to);
          return a && b ? hoursBetween(a, b) : null;
        })
        .filter((x): x is number => x !== null && x >= 0),
    );

  const reasons = countBy(
    jobs.filter((j) => j.cancelReason || j.failureReason),
    (j) =>
      j.status === 'CANCELLED'
        ? `Cancelled: ${j.cancelReason}`
        : `Failed visit: ${j.failureReason}`,
    (k) => k,
  );

  const vendorRows = data.vendors
    .filter((v) => v.status !== 'PENDING')
    .map((v) => {
      const mine = jobs.filter((j) => j.vendorId === v.id);
      const offers = data.assignments.filter(
        (a) =>
          a.vendorId === v.id &&
          a.mode === 'ADMIN_ASSIGN' &&
          a.state !== 'OFFERED' &&
          inRange(a.offeredAt, range),
      );
      const done = mine.filter((j) => COMPLETED_STATUSES.includes(j.status));
      const promised = done.filter((j) => j.promisedAt);
      const onTime = promised.filter((j) => {
        const d = firstAt(data, j.id, 'DELIVERED');
        return d && d <= j.promisedAt!;
      });
      const reviews = data.reviews.filter(
        (r) =>
          r.vendorId === v.id && r.status === 'PUBLISHED' && mine.some((j) => j.id === r.jobId),
      );
      const complaints = data.complaints.filter(
        (c) => c.jobId && mine.some((j) => j.id === c.jobId),
      );
      const repairHours = avg(
        done
          .map((j) => {
            const a = firstAt(data, j.id, 'RECEIVED_AT_SHOP');
            const b = firstAt(data, j.id, 'READY_FOR_DELIVERY');
            return a && b ? hoursBetween(a, b) : null;
          })
          .filter((x): x is number => x !== null),
      );
      const perCustomer = new Map<string, number>();
      for (const j of mine) perCustomer.set(j.customerId, (perCustomer.get(j.customerId) ?? 0) + 1);
      return {
        vendorId: v.id,
        shopName: v.shopName,
        jobs: mine.length,
        acceptanceRate: offers.length
          ? offers.filter((a) => a.state === 'ACCEPTED').length / offers.length
          : null,
        completionRate: mine.length ? done.length / mine.length : null,
        cancellationRate: mine.length
          ? mine.filter((j) => j.status === 'CANCELLED').length / mine.length
          : null,
        avgRepairHours: repairHours,
        onTimeRate: promised.length ? onTime.length / promised.length : null,
        rating: avg(reviews.map((r) => r.rating)),
        reviews: reviews.length,
        complaintRate: mine.length ? complaints.length / mine.length : null,
        repeatCustomers: [...perCustomer.values()].filter((n) => n > 1).length,
      };
    })
    .sort((a, b) => b.jobs - a.jobs);

  const perCustomer = new Map<string, number>();
  for (const j of jobs) perCustomer.set(j.customerId, (perCustomer.get(j.customerId) ?? 0) + 1);
  const customersWithJobs = perCustomer.size;
  const repeatCustomers = [...perCustomer.values()].filter((n) => n > 1).length;

  const reviews = data.reviews.filter((r) => r.status === 'PUBLISHED' && inRange(r.at, range));
  const ratingDist = [5, 4, 3, 2, 1].map((n) => ({
    key: String(n),
    label: `${n} star`,
    count: reviews.filter((r) => r.rating === n).length,
  }));

  return {
    byStatus: countBy(
      jobs,
      (j) => j.status,
      (k) => k,
    ),
    byDay: dailySeries(
      range,
      jobs.map((j) => ({ at: j.createdAt, value: 1 })),
    ),
    byVendor: countBy(jobs, (j) => j.vendorId ?? 'none', shop, value),
    byBrand: countBy(jobs, (j) => j.brandId, brand, value),
    byModel: countBy(jobs, (j) => j.modelId, model, value).slice(0, 10),
    byCategory: countBy(jobs, (j) => j.categoryId, name(data.categories), value),
    byArea: countBy(jobs, (j) => j.pickupAddress.area, name(data.areas), value),
    avgAcceptanceHours: durations('SUBMITTED', 'VENDOR_ACCEPTED'),
    avgPickupHours: durations('VENDOR_ACCEPTED', 'PHONE_COLLECTED'),
    avgRepairHours: durations('RECEIVED_AT_SHOP', 'READY_FOR_DELIVERY'),
    avgDeliveryHours: durations('READY_FOR_DELIVERY', 'DELIVERED', false),
    overdue: data.jobs.filter((j) => isOverdue(j, data.now)),
    reasons,
    vendors: vendorRows,
    repeatRate: customersWithJobs ? repeatCustomers / customersWithJobs : null,
    customersWithJobs,
    repeatCustomers,
    ratingAverage: avg(reviews.map((r) => r.rating)),
    ratingDist,
    complaints: data.complaints.filter((c) => inRange(c.createdAt, range)).length,
    disputes: data.complaints.filter((c) => c.isDispute && inRange(c.createdAt, range)).length,
  };
}

export type Granularity = 'day' | 'week' | 'month' | 'year';

/** Bucket key for an instant: day YYYY-MM-DD, ISO week start (Monday), month YYYY-MM, year YYYY. */
export function bucket(iso: string, g: Granularity): string {
  const day = pkDay(iso);
  if (g === 'day') return day;
  if (g === 'month') return day.slice(0, 7);
  if (g === 'year') return day.slice(0, 4);
  const d = new Date(`${day}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** All buckets between two Karachi days, inclusive, so charts have no gaps. */
export function bucketsBetween(range: DateRange, g: Granularity): string[] {
  const out: string[] = [];
  const end = new Date(`${range.to}T00:00:00Z`);
  for (let d = new Date(`${range.from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = bucket(`${d.toISOString().slice(0, 10)}T12:00:00+05:00`, g);
    if (out.at(-1) !== key) out.push(key);
    if (out.length > 800) break;
  }
  return out;
}

function dailySeries(range: DateRange, points: { at: string; value: number }[]) {
  const span = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000;
  const g: Granularity = span > 400 ? 'month' : span > 92 ? 'week' : 'day';
  const keys = bucketsBetween(range, g);
  const map = new Map(keys.map((k) => [k, 0]));
  for (const p of points) {
    const k = bucket(p.at, g);
    if (map.has(k)) map.set(k, map.get(k)! + p.value);
  }
  return { granularity: g, keys, values: keys.map((k) => map.get(k)!) };
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH_ON_DELIVERY: 'Cash on delivery',
  CASH_TO_VENDOR: 'Cash at shop',
  BANK_TRANSFER: 'Bank transfer',
  ONLINE: 'Online',
};

export function financialReport(data: ReportData, range: DateRange, g: Granularity) {
  const keys = bucketsBetween(range, g);
  const series = (points: { at: string; value: number }[]) => {
    const map = new Map(keys.map((k) => [k, 0]));
    for (const p of points) {
      if (!inRange(p.at, range)) continue;
      const k = bucket(p.at, g);
      if (map.has(k)) map.set(k, map.get(k)! + p.value);
    }
    return keys.map((k) => map.get(k)!);
  };
  const confirmed = data.transactions.filter((t) => t.status === 'CONFIRMED');
  const payments = confirmed.filter((t) => t.kind === 'PAYMENT');
  const refunds = confirmed.filter((t) => t.kind === 'REFUND');
  const finals = data.jobs
    .map((j) => ({ job: j, at: finalAt(data, j) }))
    .filter((x): x is { job: RepairJob; at: string } => !!x.at);
  const jobsInRange = data.jobs.filter((j) => inRange(j.createdAt, range));
  const fin = (j: RepairJob) => jobFinancials(j, data.quotations, data.transactions);

  const byMethod = new Map<PaymentMethod, number>();
  for (const t of payments)
    if (inRange(t.at, range)) byMethod.set(t.method, (byMethod.get(t.method) ?? 0) + t.amount);

  const byCategory = new Map<
    string,
    { parts: number; labor: number; other: number; total: number }
  >();
  for (const j of jobsInRange) {
    const f = fin(j);
    if (!f.total) continue;
    const name = data.categories.find((c) => c.id === j.categoryId)?.name ?? '—';
    const row = byCategory.get(name) ?? { parts: 0, labor: 0, other: 0, total: 0 };
    row.parts += f.parts;
    row.labor += f.labor;
    row.other += f.diagnostic + f.delivery + f.other;
    row.total += f.total;
    byCategory.set(name, row);
  }

  const vendors = data.vendors
    .filter((v) => v.status !== 'PENDING')
    .map((v) => {
      const b = vendorBalance(
        v.id,
        data.jobs,
        data.quotations,
        data.transactions,
        data.settlements,
      );
      const earnedInRange = finals
        .filter((x) => x.job.vendorId === v.id && inRange(x.at, range))
        .reduce((s, x) => s + fin(x.job).vendorEarnings, 0);
      const settledInRange = data.settlements
        .filter((s) => s.vendorId === v.id && inRange(s.at, range))
        .reduce((s, x) => s + x.amount, 0);
      return { vendorId: v.id, shopName: v.shopName, earnedInRange, settledInRange, ...b };
    });

  const outstandingJobs = data.jobs
    .filter((j) => ['DELIVERED', 'RETURNED_WITHOUT_REPAIR', 'DISPUTED'].includes(j.status))
    .map((j) => ({ job: j, f: fin(j) }))
    .filter((x) => x.f.outstanding > 0);

  const totalCollected = payments
    .filter((t) => inRange(t.at, range))
    .reduce((s, t) => s + t.amount, 0);
  const totalRefunds = refunds
    .filter((t) => inRange(t.at, range))
    .reduce((s, t) => s + t.amount, 0);
  const commission = finals
    .filter((x) => inRange(x.at, range))
    .reduce((s, x) => s + fin(x.job).commission, 0);
  const discounts = jobsInRange.reduce((s, j) => s + fin(j).discount, 0);
  const tax = jobsInRange.reduce((s, j) => s + fin(j).tax, 0);

  return {
    keys,
    collectedSeries: series(payments.map((t) => ({ at: t.at, value: t.amount }))),
    refundSeries: series(refunds.map((t) => ({ at: t.at, value: t.amount }))),
    commissionSeries: series(finals.map((x) => ({ at: x.at, value: fin(x.job).commission }))),
    byMethod: [...byMethod.entries()]
      .map(([method, amount]) => ({ method, label: METHOD_LABEL[method], amount }))
      .sort((a, b) => b.amount - a.amount),
    byCategory: [...byCategory.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total),
    vendors,
    outstandingJobs,
    refunds: refunds.filter((t) => inRange(t.at, range)),
    totals: {
      grossValue: jobsInRange.reduce((s, j) => s + fin(j).total, 0),
      collected: totalCollected,
      refunds: totalRefunds,
      netCollected: totalCollected - totalRefunds,
      commission,
      vendorEarnings: finals
        .filter((x) => inRange(x.at, range))
        .reduce((s, x) => s + fin(x.job).vendorEarnings, 0),
      discounts,
      tax,
      outstanding: outstandingJobs.reduce((s, x) => s + x.f.outstanding, 0),
    },
  };
}

// ---------- CSV ----------

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** RFC 4180 CSV. Cells that a spreadsheet would run as a formula are prefixed with '. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  return lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 (e.g. "Rs" and Urdu names) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
