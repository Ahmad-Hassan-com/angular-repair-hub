import { commissionFor, jobFinancials, quoteTotals, validateQuote, vendorBalance } from './finance';
import { PaymentTransaction, QuotationItem, RepairJob, RepairQuotation } from './models';

const items: QuotationItem[] = [
  { type: 'PART', description: 'Display', quantity: 1, unitPrice: 9000 },
  { type: 'LABOR', description: 'Labour', quantity: 1, unitPrice: 1500 },
  { type: 'DELIVERY', description: 'Pickup and delivery', quantity: 1, unitPrice: 500 },
  { type: 'PART', description: 'Screws', quantity: 4, unitPrice: 25 },
];

describe('quoteTotals', () => {
  it('splits the quote by type and applies discount before tax', () => {
    expect(quoteTotals(items, 600, 5)).toEqual({
      parts: 9100,
      labor: 1500,
      diagnostic: 0,
      delivery: 500,
      other: 0,
      subtotal: 11100,
      discount: 600,
      tax: 525,
      total: 11025,
    });
  });

  it('rounds tax to whole rupees', () => {
    expect(
      quoteTotals([{ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 999 }], 0, 17).tax,
    ).toBe(170);
  });
});

describe('validateQuote', () => {
  it('accepts a valid quote', () => expect(validateQuote(items, 0, 0)).toBeNull());
  it('rejects empty quotes, fractions, negatives and oversized discounts', () => {
    expect(validateQuote([], 0, 0)).toMatch(/at least one/);
    expect(validateQuote([{ ...items[0], quantity: 0.5 }], 0, 0)).toMatch(/whole/);
    expect(validateQuote([{ ...items[0], unitPrice: -1 }], 0, 0)).toMatch(/Prices/);
    expect(validateQuote(items, 20000, 0)).toMatch(/Discount/);
    expect(validateQuote(items, 0, 50)).toMatch(/Tax/);
  });
});

describe('commissionFor', () => {
  it('combines percentage and fixed fee', () => expect(commissionFor(10000, 12, 100)).toBe(1300));
  it('supports percentage only and fixed only', () => {
    expect(commissionFor(10000, 10, 0)).toBe(1000);
    expect(commissionFor(10000, 0, 250)).toBe(250);
  });
  it('never exceeds the base and is zero for nothing', () => {
    expect(commissionFor(80, 10, 100)).toBe(80);
    expect(commissionFor(0, 10, 100)).toBe(0);
  });
});

const job = (over: Partial<RepairJob> = {}): RepairJob => ({
  id: 'j1',
  ref: 'MRH-1',
  customerId: 'c',
  vendorId: 'v',
  brandId: 'b',
  modelId: 'm',
  categoryId: 'k',
  description: '',
  photoIds: [],
  pickupAddress: { line1: '', area: 'a', city: '' },
  deliveryAddress: { line1: '', area: 'a', city: '' },
  preferredPickupDate: '2026-10-01',
  preferredPickupWindow: '09:00-12:00',
  diagnosticConsent: true,
  diagnosticFee: 500,
  status: 'PAID',
  outcome: 'REPAIRED',
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const quotation = (over: Partial<RepairQuotation> = {}): RepairQuotation => ({
  id: 'q1',
  jobId: 'j1',
  version: 1,
  items,
  discount: 0,
  taxRatePct: 0,
  estimatedCompletion: '',
  warrantyDays: 0,
  commissionPct: 10,
  commissionFixed: 0,
  status: 'APPROVED',
  createdBy: 'v',
  createdAt: '',
  ...over,
});
const txn = (
  kind: 'PAYMENT' | 'REFUND',
  amount: number,
  collector: 'PLATFORM' | 'VENDOR',
  status: PaymentTransaction['status'] = 'CONFIRMED',
): PaymentTransaction => ({
  id: `${kind}${amount}${collector}`,
  jobId: 'j1',
  kind,
  method: 'CASH_ON_DELIVERY',
  collector,
  amount,
  idempotencyKey: `${kind}${amount}${collector}${status}`,
  status,
  recordedBy: 'x',
  at: '2026-10-01T00:00:00Z',
});

describe('jobFinancials', () => {
  it('bills the latest approved quotation and ignores pending ones', () => {
    const f = jobFinancials(
      job(),
      [quotation(), quotation({ id: 'q2', version: 2, status: 'PENDING', items: [items[0]] })],
      [],
    );
    expect(f.total).toBe(11100);
    expect(f.outstanding).toBe(11100);
  });

  it('separates paid, outstanding, commission and vendor earnings', () => {
    const f = jobFinancials(
      job(),
      [quotation()],
      [txn('PAYMENT', 5000, 'VENDOR'), txn('PAYMENT', 6100, 'PLATFORM')],
    );
    expect(f).toMatchObject({
      paid: 11100,
      outstanding: 0,
      commission: 1110,
      vendorEarnings: 9990,
      collectedByVendor: 5000,
      collectedByPlatform: 6100,
      recognised: true,
    });
  });

  it('ignores unverified transfers', () => {
    expect(
      jobFinancials(
        job(),
        [quotation()],
        [txn('PAYMENT', 11100, 'PLATFORM', 'PENDING_VERIFICATION')],
      ).paid,
    ).toBe(0);
  });

  it('reduces commission after a partial refund', () => {
    const f = jobFinancials(
      job(),
      [quotation()],
      [txn('PAYMENT', 11100, 'PLATFORM'), txn('REFUND', 1100, 'PLATFORM')],
    );
    expect(f.commissionBase).toBe(10000);
    expect(f.commission).toBe(1000);
    expect(f.outstanding).toBe(0);
  });

  it('bills the consented diagnostic fee for a rejected repair', () => {
    const f = jobFinancials(
      job({ outcome: 'NOT_REPAIRED', status: 'RETURNED_WITHOUT_REPAIR' }),
      [quotation({ status: 'REJECTED' })],
      [],
    );
    expect(f.total).toBe(500);
    expect(f.diagnostic).toBe(500);
  });

  it('bills nothing without diagnostic consent', () => {
    expect(
      jobFinancials(
        job({ outcome: 'NOT_REPAIRED', diagnosticConsent: false, diagnosticFee: 0 }),
        [],
        [],
      ).total,
    ).toBe(0);
  });

  it('does not recognise commission until the job is final', () => {
    expect(jobFinancials(job({ status: 'DELIVERED' }), [quotation()], []).recognised).toBe(false);
  });
});

describe('vendorBalance', () => {
  it('is positive when the platform holds the money', () => {
    const b = vendorBalance('v', [job()], [quotation()], [txn('PAYMENT', 11100, 'PLATFORM')], []);
    expect(b.balance).toBe(9990);
  });

  it('is negative when the vendor holds the cash and owes commission', () => {
    const b = vendorBalance('v', [job()], [quotation()], [txn('PAYMENT', 11100, 'VENDOR')], []);
    expect(b.balance).toBe(-1110);
  });

  it('nets settlements and counts unfinished jobs as pending', () => {
    const b = vendorBalance(
      'v',
      [job(), job({ id: 'j2', status: 'REPAIR_IN_PROGRESS' })],
      [quotation(), quotation({ id: 'q9', jobId: 'j2' })],
      [txn('PAYMENT', 11100, 'PLATFORM')],
      [
        {
          id: 's',
          vendorId: 'v',
          amount: 9000,
          reference: 'x',
          periodFrom: '',
          periodTo: '',
          createdBy: 'a',
          at: '',
        },
      ],
    );
    expect(b.balance).toBe(990);
    expect(b.pending).toBe(9990);
  });

  it('ignores other vendors', () => {
    expect(
      vendorBalance('other', [job()], [quotation()], [txn('PAYMENT', 11100, 'PLATFORM')], [])
        .balance,
    ).toBe(0);
  });
});
