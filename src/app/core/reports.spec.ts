import { Backend, ReportData } from './backend';
import { emptyDb, MemoryDb } from './db';
import {
  bucket,
  bucketsBetween,
  computeKpis,
  financialReport,
  inRange,
  operationalReport,
  pkDay,
  presetRange,
  toCsv,
} from './reports';
import { buildDemoDb, DEMO_PASSWORD } from './seed';

describe('Karachi date boundaries', () => {
  it('buckets by local day, not UTC day', () => {
    // 19:30 UTC on the 2nd is 00:30 on the 3rd in Karachi.
    expect(pkDay('2026-10-02T19:30:00Z')).toBe('2026-10-03');
    expect(pkDay('2026-10-02T18:59:59Z')).toBe('2026-10-02');
  });

  it('includes both ends of a range', () => {
    const r = { from: '2026-10-01', to: '2026-10-31' };
    expect(inRange('2026-09-30T19:00:00Z', r)).toBe(true); // 1 Oct 00:00 local
    expect(inRange('2026-10-31T18:59:00Z', r)).toBe(true); // 31 Oct 23:59 local
    expect(inRange('2026-10-31T19:00:00Z', r)).toBe(false); // 1 Nov local
  });

  it('builds presets from the Karachi date', () => {
    const now = new Date('2026-10-26T20:00:00Z'); // 27 Oct, 01:00 local
    expect(presetRange('today', now)).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    expect(presetRange('7d', now)).toEqual({ from: '2026-10-21', to: '2026-10-27' });
    expect(presetRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-27' });
  });

  it('groups weeks from Monday and lists gap-free buckets', () => {
    expect(bucket('2026-10-28T10:00:00Z', 'week')).toBe('2026-10-26');
    expect(bucket('2026-10-28T10:00:00Z', 'month')).toBe('2026-10');
    expect(bucketsBetween({ from: '2026-10-30', to: '2026-11-02' }, 'day')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(bucketsBetween({ from: '2026-01-15', to: '2026-03-02' }, 'month')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });
});

describe('report calculations on the demo data', () => {
  const now = new Date('2026-10-27T09:00:00Z');
  let data: ReportData;

  beforeAll(() => {
    const storage = new MemoryDb();
    storage.save(buildDemoDb(now));
    const api = new Backend(
      storage,
      () => emptyDb(),
      () => now,
    );
    data = api.reportData(api.login('admin@repairhub.pk', DEMO_PASSWORD).token);
  });

  it('keeps gross value, collections, commission and refunds distinct and consistent', () => {
    const all = presetRange('all', now);
    const k = computeKpis(data, all);
    const fin = financialReport(data, all, 'month');
    const payments = data.transactions
      .filter((t) => t.kind === 'PAYMENT' && t.status === 'CONFIRMED')
      .reduce((s, t) => s + t.amount, 0);
    const refunds = data.transactions
      .filter((t) => t.kind === 'REFUND')
      .reduce((s, t) => s + t.amount, 0);
    expect(k.collected).toBe(payments);
    expect(k.refunds).toBe(refunds);
    expect(fin.totals.netCollected).toBe(payments - refunds);
    expect(k.commission).toBe(fin.totals.commission);
    expect(fin.collectedSeries.reduce((a, b) => a + b, 0)).toBe(payments);
    expect(k.grossValue).toBeGreaterThan(k.collected - 1);
    expect(k.commission).toBeLessThan(k.grossValue);
  });

  it('counts every job exactly once by status', () => {
    const op = operationalReport(data, presetRange('all', now));
    expect(op.byStatus.reduce((s, r) => s + r.count, 0)).toBe(data.jobs.length);
    expect(op.byCategory.reduce((s, r) => s + r.count, 0)).toBe(data.jobs.length);
  });

  it('reports the current queue and overdue repairs', () => {
    const k = computeKpis(data, presetRange('30d', now));
    expect(k.awaitingVendor).toBe(
      data.jobs.filter((j) => j.status === 'AWAITING_VENDOR' || j.status === 'SUBMITTED').length,
    );
    expect(k.pendingApprovals).toBe(1);
    expect(k.delayed).toBeGreaterThanOrEqual(1);
    expect(k.pendingVendors).toBe(1);
  });

  it('computes turnaround averages as positive hours', () => {
    const op = operationalReport(data, presetRange('all', now));
    for (const v of [
      op.avgAcceptanceHours,
      op.avgPickupHours,
      op.avgRepairHours,
      op.avgDeliveryHours,
    ]) {
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThan(0);
    }
  });

  it('sums payments by method to total collections', () => {
    const fin = financialReport(data, presetRange('all', now), 'month');
    expect(fin.byMethod.reduce((s, m) => s + m.amount, 0)).toBe(fin.totals.collected);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv(
      [{ a: 'x, y', b: 'say "hi"', c: 'line\nbreak' }],
      [
        { header: 'A', value: (r) => r.a },
        { header: 'B', value: (r) => r.b },
        { header: 'C', value: (r) => r.c },
      ],
    );
    expect(csv).toBe('A,B,C\r\n"x, y","say ""hi""","line\nbreak"');
  });

  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    const csv = toCsv(
      [{ v: '=HYPERLINK("x")' }, { v: '-500' }, { v: null }],
      [{ header: 'V', value: (r) => r.v }],
    );
    expect(csv.split('\r\n')).toEqual(['V', '"\'=HYPERLINK(""x"")"', '-500', '']);
  });
});
