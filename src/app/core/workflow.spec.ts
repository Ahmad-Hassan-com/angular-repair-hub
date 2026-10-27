import { JobStatus } from './models';
import { ALL_STATUSES, canTransition, plainActions, STATUS_META, TRANSITIONS } from './workflow';

describe('job state machine', () => {
  it('defines transitions and display metadata for every status', () => {
    for (const s of ALL_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined();
      expect(STATUS_META[s].label).toBeTruthy();
    }
  });

  it('only points at known statuses', () => {
    for (const list of Object.values(TRANSITIONS))
      for (const t of list) expect(ALL_STATUSES).toContain(t.to);
  });

  it('can reach CLOSED from SUBMITTED along the happy path', () => {
    const path: [JobStatus, JobStatus, Parameters<typeof canTransition>[2]][] = [
      ['SUBMITTED', 'AWAITING_VENDOR', 'SYSTEM'],
      ['AWAITING_VENDOR', 'VENDOR_ACCEPTED', 'VENDOR'],
      ['VENDOR_ACCEPTED', 'PICKUP_SCHEDULED', 'VENDOR'],
      ['PICKUP_SCHEDULED', 'PICKUP_IN_PROGRESS', 'AGENT'],
      ['PICKUP_IN_PROGRESS', 'PHONE_COLLECTED', 'AGENT'],
      ['PHONE_COLLECTED', 'RECEIVED_AT_SHOP', 'VENDOR'],
      ['RECEIVED_AT_SHOP', 'INSPECTION_IN_PROGRESS', 'VENDOR'],
      ['INSPECTION_IN_PROGRESS', 'QUOTATION_SUBMITTED', 'VENDOR'],
      ['QUOTATION_SUBMITTED', 'AWAITING_APPROVAL', 'SYSTEM'],
      ['AWAITING_APPROVAL', 'QUOTATION_APPROVED', 'CUSTOMER'],
      ['QUOTATION_APPROVED', 'REPAIR_IN_PROGRESS', 'VENDOR'],
      ['REPAIR_IN_PROGRESS', 'REPAIR_COMPLETED', 'VENDOR'],
      ['REPAIR_COMPLETED', 'QUALITY_CHECKED', 'VENDOR'],
      ['QUALITY_CHECKED', 'READY_FOR_DELIVERY', 'VENDOR'],
      ['READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'AGENT'],
      ['OUT_FOR_DELIVERY', 'DELIVERED', 'AGENT'],
      ['DELIVERED', 'PAID', 'SYSTEM'],
      ['PAID', 'CLOSED', 'VENDOR'],
    ];
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor)).toBe(true);
  });

  it('forbids skipping steps', () => {
    expect(canTransition('VENDOR_ACCEPTED', 'REPAIR_IN_PROGRESS', 'VENDOR')).toBe(false);
    expect(canTransition('INSPECTION_IN_PROGRESS', 'REPAIR_IN_PROGRESS', 'VENDOR')).toBe(false);
    expect(canTransition('AWAITING_APPROVAL', 'REPAIR_IN_PROGRESS', 'VENDOR')).toBe(false);
    expect(canTransition('READY_FOR_DELIVERY', 'DELIVERED', 'VENDOR')).toBe(false);
  });

  it('forbids the wrong actor', () => {
    expect(canTransition('AWAITING_APPROVAL', 'QUOTATION_APPROVED', 'VENDOR')).toBe(false);
    expect(canTransition('AWAITING_APPROVAL', 'QUOTATION_APPROVED', 'ADMIN')).toBe(false);
    expect(canTransition('RECEIVED_AT_SHOP', 'INSPECTION_IN_PROGRESS', 'CUSTOMER')).toBe(false);
    expect(canTransition('DELIVERED', 'PAID', 'VENDOR')).toBe(false);
  });

  it('lets customers cancel only before collection', () => {
    expect(canTransition('PICKUP_SCHEDULED', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransition('PHONE_COLLECTED', 'CANCELLED', 'CUSTOMER')).toBe(false);
    expect(canTransition('REPAIR_IN_PROGRESS', 'CANCELLED', 'ADMIN')).toBe(false);
  });

  it('treats cancelled as terminal', () => expect(TRANSITIONS.CANCELLED).toEqual([]));

  it('exposes only plain transitions as buttons', () => {
    expect(plainActions('INSPECTION_IN_PROGRESS', 'VENDOR')).toEqual([]);
    expect(plainActions('REPAIR_IN_PROGRESS', 'VENDOR').map((t) => t.to)).toEqual([
      'WAITING_FOR_PARTS',
      'REPAIR_COMPLETED',
    ]);
  });
});
