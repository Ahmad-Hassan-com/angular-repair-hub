import {
  PaymentTransaction,
  Pkr,
  QuotationItem,
  RepairJob,
  RepairQuotation,
  VendorSettlement,
} from './models';
import { FINAL_STATUSES } from './workflow';

export interface QuoteTotals {
  parts: Pkr;
  labor: Pkr;
  diagnostic: Pkr;
  delivery: Pkr;
  other: Pkr;
  subtotal: Pkr;
  discount: Pkr;
  tax: Pkr;
  total: Pkr;
}

export const EMPTY_TOTALS: QuoteTotals = {
  parts: 0,
  labor: 0,
  diagnostic: 0,
  delivery: 0,
  other: 0,
  subtotal: 0,
  discount: 0,
  tax: 0,
  total: 0,
};

/** Validates quotation input; returns an error message or null. */
export function validateQuote(
  items: QuotationItem[],
  discount: Pkr,
  taxRatePct: number,
): string | null {
  if (items.length === 0) return 'Add at least one line item.';
  for (const item of items) {
    if (!item.description.trim()) return 'Every line item needs a description.';
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)
      return 'Quantities must be whole numbers from 1 to 99.';
    if (!Number.isInteger(item.unitPrice) || item.unitPrice < 0 || item.unitPrice > 1_000_000)
      return 'Prices must be whole rupees between 0 and 1,000,000.';
  }
  if (!Number.isInteger(discount) || discount < 0)
    return 'Discount must be a whole, non-negative amount.';
  if (taxRatePct < 0 || taxRatePct > 30) return 'Tax rate must be between 0% and 30%.';
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  if (discount > subtotal) return 'Discount cannot exceed the subtotal.';
  return null;
}

export function quoteTotals(
  items: QuotationItem[],
  discount: Pkr,
  taxRatePct: number,
): QuoteTotals {
  const sum = (type: QuotationItem['type']) =>
    items.filter((i) => i.type === type).reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totals = {
    parts: sum('PART'),
    labor: sum('LABOR'),
    diagnostic: sum('DIAGNOSTIC'),
    delivery: sum('DELIVERY'),
    other: sum('OTHER'),
  };
  const subtotal = totals.parts + totals.labor + totals.diagnostic + totals.delivery + totals.other;
  const taxable = Math.max(0, subtotal - discount);
  const tax = Math.round((taxable * taxRatePct) / 100);
  return { ...totals, subtotal, discount, tax, total: taxable + tax };
}

/** Percentage plus fixed fee, never more than the base it is taken from. */
export function commissionFor(base: Pkr, pct: number, fixed: Pkr): Pkr {
  if (base <= 0) return 0;
  return Math.min(base, Math.round((base * pct) / 100) + fixed);
}

export interface JobFinancials extends QuoteTotals {
  /** Confirmed payments received, before refunds. */
  paid: Pkr;
  refunded: Pkr;
  outstanding: Pkr;
  /** Revenue the commission is taken from: total less tax less refunds. */
  commissionBase: Pkr;
  commission: Pkr;
  vendorEarnings: Pkr;
  collectedByVendor: Pkr;
  collectedByPlatform: Pkr;
  /** Commission is only recognised once the job's money position is final. */
  recognised: boolean;
}

/**
 * The quotation that bills the job: the latest approved one. If the customer
 * rejected the repair or it was unrepairable, a consented diagnostic fee is billed instead.
 */
export function billableQuote(
  job: RepairJob,
  quotations: RepairQuotation[],
): Pick<
  RepairQuotation,
  'items' | 'discount' | 'taxRatePct' | 'commissionPct' | 'commissionFixed'
> | null {
  const approved = quotations
    .filter((q) => q.jobId === job.id && q.status === 'APPROVED')
    .sort((a, b) => b.version - a.version)[0];
  if (approved) return approved;
  if (job.outcome === 'NOT_REPAIRED' && job.diagnosticConsent && job.diagnosticFee > 0) {
    const latest = quotations
      .filter((q) => q.jobId === job.id)
      .sort((a, b) => b.version - a.version)[0];
    return {
      items: [
        {
          type: 'DIAGNOSTIC',
          description: 'Diagnostic fee',
          quantity: 1,
          unitPrice: job.diagnosticFee,
        },
      ],
      discount: 0,
      taxRatePct: 0,
      commissionPct: latest?.commissionPct ?? 0,
      commissionFixed: 0,
    };
  }
  return null;
}

export function jobFinancials(
  job: RepairJob,
  quotations: RepairQuotation[],
  transactions: PaymentTransaction[],
): JobFinancials {
  const quote = billableQuote(job, quotations);
  const totals = quote ? quoteTotals(quote.items, quote.discount, quote.taxRatePct) : EMPTY_TOTALS;
  const tx = transactions.filter((t) => t.jobId === job.id && t.status === 'CONFIRMED');
  const total = (kind: PaymentTransaction['kind'], collector?: PaymentTransaction['collector']) =>
    tx
      .filter((t) => t.kind === kind && (!collector || t.collector === collector))
      .reduce((s, t) => s + t.amount, 0);

  const paid = total('PAYMENT');
  const refunded = total('REFUND');
  const commissionBase = Math.max(0, totals.total - totals.tax - refunded);
  const commission = quote
    ? commissionFor(commissionBase, quote.commissionPct, quote.commissionFixed)
    : 0;
  return {
    ...totals,
    paid,
    refunded,
    outstanding: Math.max(0, totals.total - paid),
    commissionBase,
    commission,
    vendorEarnings: commissionBase - commission,
    collectedByVendor: total('PAYMENT', 'VENDOR') - total('REFUND', 'VENDOR'),
    collectedByPlatform: total('PAYMENT', 'PLATFORM') - total('REFUND', 'PLATFORM'),
    recognised: FINAL_STATUSES.includes(job.status),
  };
}

export interface VendorBalance {
  /** Vendor earnings on jobs whose money position is final. */
  earnings: Pkr;
  commission: Pkr;
  /** Cash the vendor collected on those jobs (net of refunds the vendor paid). */
  heldByVendor: Pkr;
  /** Net settlements: positive means the platform has paid the vendor. */
  settled: Pkr;
  /** Positive: the platform owes the vendor. Negative: the vendor owes the platform. */
  balance: Pkr;
  /** Earnings on approved jobs whose money position is not final yet. */
  pending: Pkr;
}

/**
 * Who owes whom. For each final job the vendor is entitled to its earnings but may
 * already hold cash it collected; the difference is owed one way or the other.
 */
export function vendorBalance(
  vendorId: string,
  jobs: RepairJob[],
  quotations: RepairQuotation[],
  transactions: PaymentTransaction[],
  settlements: VendorSettlement[],
): VendorBalance {
  let earnings = 0;
  let commission = 0;
  let heldByVendor = 0;
  let pending = 0;
  for (const job of jobs) {
    if (job.vendorId !== vendorId) continue;
    const f = jobFinancials(job, quotations, transactions);
    if (f.recognised) {
      earnings += f.vendorEarnings;
      commission += f.commission;
      heldByVendor += f.collectedByVendor;
    } else if (f.total > 0 && job.status !== 'CANCELLED') {
      pending += f.vendorEarnings;
    }
  }
  const settled = settlements
    .filter((s) => s.vendorId === vendorId)
    .reduce((s, x) => s + x.amount, 0);
  return {
    earnings,
    commission,
    heldByVendor,
    settled,
    balance: earnings - heldByVendor - settled,
    pending,
  };
}

const pkr = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

export function formatPkr(value: Pkr): string {
  return `Rs ${pkr.format(value)}`;
}
