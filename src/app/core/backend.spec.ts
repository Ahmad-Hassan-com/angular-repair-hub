import { ApiError, Backend } from './backend';
import { hashSecret, randomHex, sha256 } from './crypto';
import { Db, emptyDb, MemoryDb } from './db';
import { jobFinancials, vendorBalance } from './finance';
import { User } from './models';
import { buildDemoDb, DEMO_PASSWORD } from './seed';

// Integration tests: each one drives the backend exactly as the UI does, through
// session tokens, against a fresh in-memory database.

const PASSWORD = 'Secret123';

interface World {
  api: Backend;
  storage: MemoryDb;
  advance: (hours: number) => void;
  tokens: Record<
    'admin' | 'ops' | 'vendorA' | 'vendorB' | 'pending' | 'customer' | 'other' | 'agent',
    string
  >;
  ids: Record<'vendorA' | 'vendorB' | 'customer' | 'agent', string>;
}

function world(mode: 'FIRST_ACCEPT' | 'ADMIN_ASSIGN' = 'FIRST_ACCEPT'): World {
  let now = Date.parse('2026-10-20T06:00:00Z');
  const db = emptyDb();
  db.settings.assignmentMode = mode;
  db.brands.push(
    { id: 'b1', name: 'Samsung', active: true },
    { id: 'b2', name: 'Apple', active: true },
  );
  db.models.push(
    { id: 'm1', brandId: 'b1', name: 'Galaxy S24' },
    { id: 'm2', brandId: 'b2', name: 'iPhone 14' },
  );
  db.categories.push({
    id: 'c1',
    name: 'Screen',
    icon: 'smartphone',
    fromPrice: 3000,
    active: true,
  });
  db.areas.push(
    { id: 'a1', name: 'Gulberg', city: 'Lahore', active: true },
    { id: 'a2', name: 'Clifton', city: 'Karachi', active: true },
  );
  const user = (
    id: string,
    role: User['role'],
    email: string,
    permissions: User['permissions'] = [],
  ) => {
    const salt = randomHex(4);
    db.users.push({
      id,
      role,
      name: id,
      email,
      phone: `+9230000000${db.users.length.toString().padStart(2, '0')}`,
      phoneVerified: true,
      passwordHash: hashSecret(PASSWORD, salt),
      salt,
      status: 'ACTIVE',
      permissions,
      createdAt: new Date(now).toISOString(),
      failedLogins: 0,
    });
  };
  user('admin', 'SUPER_ADMIN', 'admin@t.pk');
  user('ops', 'STAFF', 'ops@t.pk', ['jobs.view']);
  user('vendorA', 'VENDOR', 'a@t.pk');
  user('vendorB', 'VENDOR', 'b@t.pk');
  user('pending', 'VENDOR', 'p@t.pk');
  user('customer', 'CUSTOMER', 'c@t.pk');
  user('other', 'CUSTOMER', 'o@t.pk');
  user('agent', 'AGENT', 'g@t.pk');
  db.customers.push({ userId: 'customer', addresses: [] }, { userId: 'other', addresses: [] });
  const vendor = (userId: string, status: 'APPROVED' | 'PENDING', areas = ['a1']) =>
    db.vendors.push({
      userId,
      shopName: `${userId} shop`,
      ownerName: userId,
      address: { line1: 'Main Blvd 1', area: 'a1', city: 'Lahore' },
      serviceAreas: areas,
      specialties: ['c1'],
      brands: ['b1', 'b2'],
      documents: [],
      termsAcceptedAt: new Date(now).toISOString(),
      status,
      available: true,
      hours: { days: [1, 2, 3, 4, 5, 6], open: '10:00', close: '20:00' },
    });
  vendor('vendorA', 'APPROVED');
  vendor('vendorB', 'APPROVED');
  vendor('pending', 'PENDING');

  const storage = new MemoryDb();
  storage.save(db);
  const api = new Backend(
    storage,
    () => emptyDb(),
    () => new Date(now),
  );
  const login = (email: string) => api.login(email, PASSWORD).token;
  return {
    api,
    storage,
    advance: (h) => (now += h * 3_600_000),
    tokens: {
      admin: login('admin@t.pk'),
      ops: login('ops@t.pk'),
      vendorA: login('a@t.pk'),
      vendorB: login('b@t.pk'),
      pending: login('p@t.pk'),
      customer: login('c@t.pk'),
      other: login('o@t.pk'),
      agent: login('g@t.pk'),
    },
    ids: { vendorA: 'vendorA', vendorB: 'vendorB', customer: 'customer', agent: 'agent' },
  };
}

const address = { line1: 'House 12, Street 4', area: 'a1', city: 'Lahore' };
const request = (overrides = {}) => ({
  brandId: 'b1',
  modelId: 'm1',
  categoryId: 'c1',
  description: 'Screen cracked after a fall.',
  photoIds: [],
  pickupAddress: address,
  deliveryAddress: address,
  preferredPickupDate: '2026-10-21',
  preferredPickupWindow: '12:00-15:00' as const,
  diagnosticConsent: true,
  ...overrides,
});
const quote = (extra = 0) => ({
  findings: 'Display cracked, digitizer dead.',
  proposedRepair: 'Replace display assembly.',
  items: [
    { type: 'PART' as const, description: 'Display', quantity: 1, unitPrice: 9000 + extra },
    { type: 'LABOR' as const, description: 'Labour', quantity: 1, unitPrice: 1500 },
    { type: 'DELIVERY' as const, description: 'Pickup and delivery', quantity: 1, unitPrice: 500 },
  ],
  discount: 0,
  estimatedCompletion: '2026-10-23',
  warrantyDays: 90,
});
const condition = {
  physicalCondition: 'GOOD' as const,
  existingDamage: 'Scratches',
  accessories: [],
  powersOn: true,
  photoIds: [],
  imei: '356789012345678',
};

function expectError(fn: () => unknown, code: ApiError['code'], message?: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(code);
    if (message) expect((e as ApiError).message).toMatch(message);
    return;
  }
  throw new Error(`Expected ${code} error`);
}

const db = (w: World) => w.storage.load() as Db;

/** Takes a job from request to an approved quotation with vendor A. */
function toApproved(w: World, opts: { agent?: boolean } = {}) {
  const { api, tokens: t } = w;
  const job = api.createRequest(t.customer, request());
  api.acceptJob(t.vendorA, job.id);
  api.schedulePickup(t.vendorA, job.id, {
    date: '2026-10-21',
    window: '12:00-15:00',
    fee: 250,
    assigneeId: opts.agent ? 'agent' : undefined,
  });
  const courier = opts.agent ? t.agent : t.vendorA;
  api.advance(courier, job.id, 'PICKUP_IN_PROGRESS');
  const { code } = api.generateHandoverCode(t.customer, job.id);
  api.confirmCollection(courier, job.id, code, condition);
  api.advance(t.vendorA, job.id, 'RECEIVED_AT_SHOP');
  api.advance(t.vendorA, job.id, 'INSPECTION_IN_PROGRESS');
  api.submitQuotation(t.vendorA, job.id, quote());
  const q = api.getJob(t.customer, job.id).quotations[0];
  api.respondToQuotation(t.customer, job.id, q.id, true);
  return { id: job.id, courier };
}

function toDelivered(w: World, opts: { agent?: boolean } = {}) {
  const { api, tokens: t } = w;
  const { id, courier } = toApproved(w, opts);
  api.advance(t.vendorA, id, 'REPAIR_IN_PROGRESS');
  api.advance(t.vendorA, id, 'REPAIR_COMPLETED');
  api.advance(t.vendorA, id, 'QUALITY_CHECKED');
  api.scheduleDelivery(t.vendorA, id, {
    date: '2026-10-21',
    window: '18:00-21:00',
    fee: 250,
    assigneeId: opts.agent ? 'agent' : undefined,
  });
  api.advance(courier, id, 'OUT_FOR_DELIVERY');
  api.confirmDelivery(courier, id, api.generateHandoverCode(t.customer, id).code);
  return { id, courier };
}

describe('authentication', () => {
  it('registers a customer with a normalised phone and signs them in', () => {
    const w = world();
    const res = w.api.registerCustomer({
      name: 'New Person',
      email: 'NEW@x.pk',
      phone: '0301 2345678',
      password: 'abc12345',
    });
    expect(res.user.email).toBe('new@x.pk');
    expect(res.user.phone).toBe('+923012345678');
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(w.api.me(res.token).user.role).toBe('CUSTOMER');
  });

  it('rejects duplicate emails, weak passwords and bad phone numbers', () => {
    const w = world();
    expectError(
      () =>
        w.api.registerCustomer({
          name: 'Dup',
          email: 'c@t.pk',
          phone: '03011111111',
          password: 'abc12345',
        }),
      'CONFLICT',
    );
    expectError(
      () =>
        w.api.registerCustomer({
          name: 'Weak',
          email: 'w@x.pk',
          phone: '03011111111',
          password: 'short',
        }),
      'VALIDATION',
    );
    expectError(
      () =>
        w.api.registerCustomer({
          name: 'Phone',
          email: 'p@x.pk',
          phone: '12345',
          password: 'abc12345',
        }),
      'VALIDATION',
    );
  });

  it('stores only salted password hashes and hashed session tokens', () => {
    const w = world();
    const { token } = w.api.registerCustomer({
      name: 'Hash Me',
      email: 'h@x.pk',
      phone: '03019999999',
      password: 'abc12345',
    });
    const raw = JSON.stringify(db(w));
    expect(raw).not.toContain('abc12345');
    expect(raw).not.toContain(token);
    expect(db(w).sessions.some((s) => s.token === sha256(token))).toBe(true);
  });

  it('locks an account after repeated failed sign-ins', () => {
    const w = world();
    for (let i = 0; i < 5; i++)
      expectError(() => w.api.login('c@t.pk', 'wrong'), 'UNAUTHENTICATED');
    expectError(() => w.api.login('c@t.pk', PASSWORD), 'RATE_LIMITED');
    w.advance(0.3);
    expect(w.api.login('c@t.pk', PASSWORD).token).toBeTruthy();
  });

  it('rejects unknown and logged-out tokens', () => {
    const w = world();
    expectError(() => w.api.listJobs('nope'), 'UNAUTHENTICATED');
    w.api.logout(w.tokens.customer);
    expectError(() => w.api.listJobs(w.tokens.customer), 'UNAUTHENTICATED');
  });

  it('verifies a phone number with a hashed, single-use code', () => {
    const w = world();
    const { token } = w.api.registerCustomer({
      name: 'Verify Me',
      email: 'v@x.pk',
      phone: '03018888888',
      password: 'abc12345',
    });
    const { demoCode, sentVia } = w.api.requestPhoneCode(token);
    expect(sentVia).toBe('IN_APP_DEMO');
    expect(JSON.stringify(db(w).phoneCodes)).not.toContain(demoCode!);
    expectError(
      () => w.api.verifyPhone(token, '000000' === demoCode ? '111111' : '000000'),
      'VALIDATION',
    );
    w.api.verifyPhone(token, demoCode!);
    expect(w.api.me(token).user.phoneVerified).toBe(true);
  });
});

describe('vendor approval', () => {
  it('keeps new vendors pending until an admin approves them', () => {
    const w = world();
    const { token } = w.api.registerVendor({
      ownerName: 'Owner',
      shopName: 'New Shop',
      email: 'shop@x.pk',
      phone: '03017777777',
      password: 'abc12345',
      address,
      serviceAreas: ['a1'],
      specialties: ['c1'],
      brands: ['b1'],
      acceptTerms: true,
    });
    expect(w.api.me(token).vendor?.status).toBe('PENDING');
    expectError(() => w.api.marketplace(token), 'FORBIDDEN');
    const vendorId = w.api.me(token).user.id;
    expectError(() => w.api.setVendorStatus(w.tokens.ops, vendorId, 'APPROVED'), 'FORBIDDEN');
    w.api.setVendorStatus(w.tokens.admin, vendorId, 'APPROVED');
    expect(w.api.marketplace(token)).toEqual([]);
  });

  it('requires a reason to reject or suspend, and only allows valid status changes', () => {
    const w = world();
    expectError(() => w.api.setVendorStatus(w.tokens.admin, 'pending', 'REJECTED'), 'VALIDATION');
    expectError(
      () => w.api.setVendorStatus(w.tokens.admin, 'pending', 'SUSPENDED', 'Fraud'),
      'CONFLICT',
    );
    w.api.setVendorStatus(w.tokens.admin, 'pending', 'REJECTED', 'Documents unreadable');
  });

  it('requires accepting the terms', () => {
    const w = world();
    expectError(
      () =>
        w.api.registerVendor({
          ownerName: 'O',
          shopName: 'S',
          email: 's@x.pk',
          phone: '03016666666',
          password: 'abc12345',
          address,
          serviceAreas: ['a1'],
          specialties: ['c1'],
          brands: ['b1'],
          acceptTerms: false,
        }),
      'VALIDATION',
    );
  });
});

describe('repair requests and the marketplace', () => {
  it('publishes a new request to eligible vendors only, without private details', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    expect(job.status).toBe('AWAITING_VENDOR');
    expect(w.api.marketplace(w.tokens.vendorA).map((j) => j.id)).toEqual([job.id]);
    const view = w.api.getJob(w.tokens.vendorA, job.id);
    expect(view.access).toBe('LIMITED');
    expect(view.customer).toBeUndefined();
    expect(view.job.pickupAddress.line1).not.toContain('House 12');
    expect(view.job.customerId).toBe('hidden');
    expect(view.history).toEqual([]);
  });

  it('does not show jobs outside a vendor service area', () => {
    const w = world();
    const job = w.api.createRequest(
      w.tokens.customer,
      request({
        pickupAddress: { ...address, area: 'a2' },
        deliveryAddress: { ...address, area: 'a2' },
      }),
    );
    expect(w.api.marketplace(w.tokens.vendorA)).toEqual([]);
    expectError(() => w.api.getJob(w.tokens.vendorA, job.id), 'NOT_FOUND');
  });

  it('validates the request', () => {
    const w = world();
    expectError(
      () => w.api.createRequest(w.tokens.customer, request({ modelId: 'm2' })),
      'VALIDATION',
      /brand and model/,
    );
    expectError(
      () => w.api.createRequest(w.tokens.customer, request({ description: 'short' })),
      'VALIDATION',
    );
    expectError(
      () => w.api.createRequest(w.tokens.customer, request({ preferredPickupDate: '2026-10-01' })),
      'VALIDATION',
      /past/,
    );
    expectError(() => w.api.createRequest(w.tokens.vendorA, request()), 'FORBIDDEN');
  });

  it('lets only one of two vendors accept the same job', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    // Both vendors loaded the job at the same version.
    const seenA = w.api.getJob(w.tokens.vendorA, job.id).job.version;
    const seenB = w.api.getJob(w.tokens.vendorB, job.id).job.version;
    w.api.acceptJob(w.tokens.vendorA, job.id, seenA);
    expectError(
      () => w.api.acceptJob(w.tokens.vendorB, job.id, seenB),
      'CONFLICT',
      /already been taken/,
    );
    expect(
      db(w).assignments.filter((a) => a.jobId === job.id && a.state === 'ACCEPTED'),
    ).toHaveLength(1);
    expect(w.api.getJob(w.tokens.customer, job.id).job.vendorId).toBe('vendorA');
    expectError(() => w.api.getJob(w.tokens.vendorB, job.id), 'NOT_FOUND');
  });

  it('two backends sharing storage (two browser tabs) still accept only once', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    const tab2 = new Backend(
      w.storage,
      () => emptyDb(),
      () => new Date('2026-10-20T07:00:00Z'),
    );
    tab2.acceptJob(w.tokens.vendorB, job.id);
    expectError(() => w.api.acceptJob(w.tokens.vendorA, job.id), 'CONFLICT');
  });

  it('pending vendors cannot accept jobs', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    expectError(() => w.api.acceptJob(w.tokens.pending, job.id), 'FORBIDDEN');
  });

  it('admin assignment mode offers the job to one vendor who can accept or decline', () => {
    const w = world('ADMIN_ASSIGN');
    const job = w.api.createRequest(w.tokens.customer, request());
    expect(job.status).toBe('SUBMITTED');
    expect(w.api.marketplace(w.tokens.vendorA)).toEqual([]);
    w.api.assignVendor(w.tokens.admin, job.id, 'vendorA');
    expect(w.api.marketplace(w.tokens.vendorA)[0].offeredToMe).toBe(true);
    expect(w.api.marketplace(w.tokens.vendorB)).toEqual([]);
    expectError(() => w.api.acceptJob(w.tokens.vendorB, job.id), 'CONFLICT');
    w.api.declineOffer(w.tokens.vendorA, job.id, 'Fully booked');
    expect(w.api.getJob(w.tokens.admin, job.id).job.status).toBe('SUBMITTED');
    w.api.assignVendor(w.tokens.admin, job.id, 'vendorB');
    w.api.acceptJob(w.tokens.vendorB, job.id);
    expect(w.api.getJob(w.tokens.admin, job.id).job.status).toBe('VENDOR_ACCEPTED');
  });

  it('expires an unanswered assignment after the timeout', () => {
    const w = world('ADMIN_ASSIGN');
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.assignVendor(w.tokens.admin, job.id, 'vendorA');
    w.advance(5);
    const view = w.api.getJob(w.tokens.admin, job.id);
    expect(view.job.status).toBe('SUBMITTED');
    expect(db(w).assignments[0].state).toBe('EXPIRED');
    expectError(() => w.api.acceptJob(w.tokens.vendorA, job.id), 'CONFLICT');
  });
});

describe('status transitions', () => {
  it('rejects skipped steps and wrong actors', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.acceptJob(w.tokens.vendorA, job.id);
    expectError(() => w.api.advance(w.tokens.vendorA, job.id, 'REPAIR_IN_PROGRESS'), 'CONFLICT');
    expectError(() => w.api.advance(w.tokens.vendorA, job.id, 'PICKUP_IN_PROGRESS'), 'CONFLICT');
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    expectError(() => w.api.advance(w.tokens.customer, job.id, 'PICKUP_IN_PROGRESS'), 'CONFLICT');
    expectError(() => w.api.advance(w.tokens.vendorB, job.id, 'PICKUP_IN_PROGRESS'), 'CONFLICT');
  });

  it('records an immutable history entry with actor, time and note for every change', () => {
    const w = world();
    const { id } = toApproved(w);
    const history = w.api.getJob(w.tokens.customer, id).history;
    expect(history.map((h) => h.to)).toEqual([
      'SUBMITTED',
      'AWAITING_VENDOR',
      'VENDOR_ACCEPTED',
      'PICKUP_SCHEDULED',
      'PICKUP_IN_PROGRESS',
      'PHONE_COLLECTED',
      'RECEIVED_AT_SHOP',
      'INSPECTION_IN_PROGRESS',
      'QUOTATION_SUBMITTED',
      'AWAITING_APPROVAL',
      'QUOTATION_APPROVED',
    ]);
    for (let i = 1; i < history.length; i++) expect(history[i].from).toBe(history[i - 1].to);
    expect(history.every((h) => h.at && h.actorId)).toBe(true);
  });

  it('rejects stale writes using the job version', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.acceptJob(w.tokens.vendorA, job.id);
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    const stale = w.api.getJob(w.tokens.vendorA, job.id).job.version - 1;
    expectError(
      () => w.api.advance(w.tokens.vendorA, job.id, 'PICKUP_IN_PROGRESS', '', [], stale),
      'CONFLICT',
    );
  });

  it('lets customers cancel before pickup but not after collection', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.cancelJob(w.tokens.customer, job.id, 'Changed my mind');
    expect(w.api.getJob(w.tokens.customer, job.id).job.status).toBe('CANCELLED');
    const { id } = toApproved(w);
    expectError(() => w.api.cancelJob(w.tokens.customer, id, 'Too slow'), 'CONFLICT');
  });
});

describe('pickup and delivery verification', () => {
  it('stores handover codes hashed and refuses wrong or expired codes', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.acceptJob(w.tokens.vendorA, job.id);
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    w.api.advance(w.tokens.vendorA, job.id, 'PICKUP_IN_PROGRESS');
    expectError(
      () => w.api.confirmCollection(w.tokens.vendorA, job.id, '123456', condition),
      'VALIDATION',
      /not generated/,
    );
    const { code } = w.api.generateHandoverCode(w.tokens.customer, job.id);
    expect(JSON.stringify(db(w))).not.toContain(`"${code}"`);
    const vendorView = JSON.stringify(w.api.getJob(w.tokens.vendorA, job.id));
    expect(vendorView).not.toContain('otpHash');
    const wrong = code === '000000' ? '111111' : '000000';
    expectError(
      () => w.api.confirmCollection(w.tokens.vendorA, job.id, wrong, condition),
      'VALIDATION',
      /not correct/,
    );
    expect(db(w).tasks[0].otpAttempts).toBe(1);
    w.advance(1);
    expectError(
      () => w.api.confirmCollection(w.tokens.vendorA, job.id, code, condition),
      'VALIDATION',
      /expired/,
    );
    const fresh = w.api.generateHandoverCode(w.tokens.customer, job.id).code;
    w.api.confirmCollection(w.tokens.vendorA, job.id, fresh, condition);
    expect(w.api.getJob(w.tokens.customer, job.id).job.status).toBe('PHONE_COLLECTED');
  });

  it('only the job customer can generate a handover code', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.acceptJob(w.tokens.vendorA, job.id);
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    expectError(() => w.api.generateHandoverCode(w.tokens.vendorA, job.id), 'NOT_FOUND');
    expectError(() => w.api.generateHandoverCode(w.tokens.other, job.id), 'NOT_FOUND');
  });

  it('lets a delivery agent run pickup and delivery and see only assigned jobs', () => {
    const w = world();
    const { id } = toDelivered(w, { agent: true });
    expect(
      w.api
        .myTasks(w.tokens.agent)
        .map((t) => t.task.kind)
        .sort(),
    ).toEqual(['DELIVERY', 'PICKUP']);
    expect(w.api.listJobs(w.tokens.agent).items.map((j) => j.id)).toEqual([id]);
    const other = w.api.createRequest(w.tokens.other, request());
    expectError(() => w.api.getJob(w.tokens.agent, other.id), 'NOT_FOUND');
  });

  it('masks the IMEI for the customer and agent but not for the vendor', () => {
    const w = world();
    const { id } = toApproved(w, { agent: true });
    expect(w.api.getJob(w.tokens.vendorA, id).conditions[0].imei).toBe('356789012345678');
    expect(w.api.getJob(w.tokens.customer, id).conditions[0].imei).toMatch(/^•+5678$/);
    expect(w.api.getJob(w.tokens.agent, id).conditions[0].imei).toMatch(/^•+5678$/);
  });

  it('reschedules after a failed pickup', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.acceptJob(w.tokens.vendorA, job.id);
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    w.api.advance(w.tokens.vendorA, job.id, 'PICKUP_IN_PROGRESS');
    expectError(
      () => w.api.advance(w.tokens.vendorA, job.id, 'CUSTOMER_UNAVAILABLE'),
      'VALIDATION',
    );
    w.api.advance(w.tokens.vendorA, job.id, 'CUSTOMER_UNAVAILABLE', 'No answer at the door');
    expectError(
      () =>
        w.api.scheduleDelivery(w.tokens.vendorA, job.id, {
          date: '2026-10-22',
          window: '09:00-12:00',
          fee: 0,
        }),
      'CONFLICT',
    );
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-22',
      window: '09:00-12:00',
      fee: 250,
    });
    const tasks = w.api.getJob(w.tokens.customer, job.id).tasks;
    expect(tasks.map((t) => t.status)).toEqual(['FAILED', 'SCHEDULED']);
  });
});

describe('quotations', () => {
  it('blocks repair work until the customer approves', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.acceptJob(w.tokens.vendorA, job.id);
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    w.api.advance(w.tokens.vendorA, job.id, 'PICKUP_IN_PROGRESS');
    w.api.confirmCollection(
      w.tokens.vendorA,
      job.id,
      w.api.generateHandoverCode(w.tokens.customer, job.id).code,
      condition,
    );
    w.api.advance(w.tokens.vendorA, job.id, 'RECEIVED_AT_SHOP');
    w.api.advance(w.tokens.vendorA, job.id, 'INSPECTION_IN_PROGRESS');
    w.api.submitQuotation(w.tokens.vendorA, job.id, quote());
    expectError(() => w.api.advance(w.tokens.vendorA, job.id, 'REPAIR_IN_PROGRESS'), 'CONFLICT');
    const q = w.api.getJob(w.tokens.customer, job.id).quotations[0];
    expectError(() => w.api.respondToQuotation(w.tokens.other, job.id, q.id, true), 'NOT_FOUND');
    expectError(() => w.api.respondToQuotation(w.tokens.vendorA, job.id, q.id, true), 'NOT_FOUND');
    w.api.respondToQuotation(w.tokens.customer, job.id, q.id, true);
    expectError(() => w.api.respondToQuotation(w.tokens.customer, job.id, q.id, true), 'CONFLICT');
    w.api.advance(w.tokens.vendorA, job.id, 'REPAIR_IN_PROGRESS');
  });

  it('validates quotation amounts', () => {
    const w = world();
    const { id } = toApproved(w);
    w.api.advance(w.tokens.vendorA, id, 'REPAIR_IN_PROGRESS');
    expectError(
      () => w.api.submitQuotation(w.tokens.vendorA, id, { ...quote(), items: [] }),
      'VALIDATION',
    );
    expectError(
      () =>
        w.api.submitQuotation(w.tokens.vendorA, id, {
          ...quote(),
          items: [{ type: 'PART', description: 'X part', quantity: 1, unitPrice: -5 }],
        }),
      'VALIDATION',
    );
    expectError(
      () =>
        w.api.submitQuotation(w.tokens.vendorA, id, {
          ...quote(),
          items: [{ type: 'PART', description: 'X part', quantity: 1.5, unitPrice: 100 }],
        }),
      'VALIDATION',
    );
    expectError(
      () => w.api.submitQuotation(w.tokens.vendorA, id, { ...quote(), discount: 999_999 }),
      'VALIDATION',
      /Discount/,
    );
  });

  it('asks again for additional charges and keeps earlier versions', () => {
    const w = world();
    const { id } = toApproved(w);
    w.api.advance(w.tokens.vendorA, id, 'REPAIR_IN_PROGRESS');
    w.api.submitQuotation(w.tokens.vendorA, id, quote(1200));
    let view = w.api.getJob(w.tokens.customer, id);
    expect(view.job.status).toBe('AWAITING_APPROVAL');
    expect(view.quotations.map((q) => [q.version, q.status])).toEqual([
      [2, 'PENDING'],
      [1, 'APPROVED'],
    ]);
    // Until the revision is approved, the original approved quotation is what's billable.
    expect(view.financials.total).toBe(11000);
    w.api.respondToQuotation(w.tokens.customer, id, view.quotations[0].id, true);
    view = w.api.getJob(w.tokens.customer, id);
    expect(view.quotations.map((q) => q.status)).toEqual(['APPROVED', 'SUPERSEDED']);
    expect(view.financials.total).toBe(12200);
  });

  it('bills only the consented diagnostic fee when the customer rejects the repair', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    w.api.acceptJob(w.tokens.vendorA, job.id);
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    w.api.advance(w.tokens.vendorA, job.id, 'PICKUP_IN_PROGRESS');
    w.api.confirmCollection(
      w.tokens.vendorA,
      job.id,
      w.api.generateHandoverCode(w.tokens.customer, job.id).code,
      condition,
    );
    w.api.advance(w.tokens.vendorA, job.id, 'RECEIVED_AT_SHOP');
    w.api.advance(w.tokens.vendorA, job.id, 'INSPECTION_IN_PROGRESS');
    w.api.submitQuotation(w.tokens.vendorA, job.id, quote());
    const q = w.api.getJob(w.tokens.customer, job.id).quotations[0];
    expectError(
      () => w.api.respondToQuotation(w.tokens.customer, job.id, q.id, false),
      'VALIDATION',
    );
    w.api.respondToQuotation(w.tokens.customer, job.id, q.id, false, 'Too expensive');
    expect(w.api.getJob(w.tokens.customer, job.id).financials.total).toBe(500);
    w.api.scheduleDelivery(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '18:00-21:00',
      fee: 0,
    });
    w.api.advance(w.tokens.vendorA, job.id, 'OUT_FOR_DELIVERY');
    w.api.confirmDelivery(
      w.tokens.vendorA,
      job.id,
      w.api.generateHandoverCode(w.tokens.customer, job.id).code,
    );
    expect(w.api.getJob(w.tokens.customer, job.id).job.status).toBe('RETURNED_WITHOUT_REPAIR');
    w.api.recordPayment(w.tokens.vendorA, job.id, {
      method: 'CASH_TO_VENDOR',
      amount: 500,
      idempotencyKey: 'diag-1-key',
    });
    expect(w.api.getJob(w.tokens.customer, job.id).job.status).toBe('PAID');
  });

  it('closes an unrepairable phone without charge when no diagnostic consent was given', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request({ diagnosticConsent: false }));
    w.api.acceptJob(w.tokens.vendorA, job.id);
    w.api.schedulePickup(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '09:00-12:00',
      fee: 250,
    });
    w.api.advance(w.tokens.vendorA, job.id, 'PICKUP_IN_PROGRESS');
    w.api.confirmCollection(
      w.tokens.vendorA,
      job.id,
      w.api.generateHandoverCode(w.tokens.customer, job.id).code,
      condition,
    );
    w.api.advance(w.tokens.vendorA, job.id, 'RECEIVED_AT_SHOP');
    w.api.advance(w.tokens.vendorA, job.id, 'INSPECTION_IN_PROGRESS');
    w.api.markUnrepairable(w.tokens.vendorA, job.id, 'Board is corroded beyond repair.');
    w.api.scheduleDelivery(w.tokens.vendorA, job.id, {
      date: '2026-10-21',
      window: '18:00-21:00',
      fee: 0,
    });
    w.api.advance(w.tokens.vendorA, job.id, 'OUT_FOR_DELIVERY');
    w.api.confirmDelivery(
      w.tokens.vendorA,
      job.id,
      w.api.generateHandoverCode(w.tokens.customer, job.id).code,
    );
    expect(w.api.getJob(w.tokens.customer, job.id).job.status).toBe('CLOSED');
  });
});

describe('payments, commissions, refunds and settlements', () => {
  it('records payment once even if submitted twice', () => {
    const w = world();
    const { id } = toDelivered(w);
    const input = {
      method: 'CASH_ON_DELIVERY' as const,
      amount: 11000,
      idempotencyKey: 'cod-abc-123',
    };
    w.api.recordPayment(w.tokens.vendorA, id, input);
    w.api.recordPayment(w.tokens.vendorA, id, input);
    expect(w.api.getJob(w.tokens.customer, id).transactions).toHaveLength(1);
    expect(w.api.getJob(w.tokens.customer, id).job.status).toBe('PAID');
  });

  it('refuses overpayment, online entries by hand and customer self-confirmation', () => {
    const w = world();
    const { id } = toDelivered(w);
    expectError(
      () =>
        w.api.recordPayment(w.tokens.vendorA, id, {
          method: 'CASH_ON_DELIVERY',
          amount: 20000,
          idempotencyKey: 'over-pay-1',
        }),
      'VALIDATION',
    );
    expectError(
      () =>
        w.api.recordPayment(w.tokens.vendorA, id, {
          method: 'ONLINE',
          amount: 100,
          idempotencyKey: 'online-pay-1',
        }),
      'UNAVAILABLE',
    );
    expectError(
      () =>
        w.api.recordPayment(w.tokens.customer, id, {
          method: 'CASH_ON_DELIVERY',
          amount: 100,
          idempotencyKey: 'self-pay-1',
        }),
      'FORBIDDEN',
    );
  });

  it('keeps a reported bank transfer unconfirmed until staff verify it', () => {
    const w = world();
    const { id } = toDelivered(w);
    w.api.reportTransfer(w.tokens.customer, id, {
      amount: 11000,
      reference: 'IBFT-1',
      idempotencyKey: 'transfer-1-key',
    });
    let view = w.api.getJob(w.tokens.customer, id);
    expect(view.financials.paid).toBe(0);
    expect(view.job.status).toBe('DELIVERED');
    w.api.verifyTransfer(w.tokens.admin, view.transactions[0].id);
    view = w.api.getJob(w.tokens.customer, id);
    expect(view.financials.paid).toBe(11000);
    expect(view.job.status).toBe('PAID');
  });

  it('ignores duplicate gateway webhooks and rejects bad signatures', () => {
    const w = world();
    const { id } = toDelivered(w);
    const raw = db(w);
    raw.settings.onlineGateway.configured = true;
    raw.secrets.gatewayWebhookSecret = 'whsec_test';
    w.storage.save(raw);
    const sign = (eventId: string, amount: number) =>
      sha256(`whsec_test|${eventId}|${id}|${amount}`);
    expect(
      w.api.gatewayWebhook({
        eventId: 'evt_1',
        jobId: id,
        amount: 11000,
        signature: sign('evt_1', 11000),
      }),
    ).toBe('RECORDED');
    expect(
      w.api.gatewayWebhook({
        eventId: 'evt_1',
        jobId: id,
        amount: 11000,
        signature: sign('evt_1', 11000),
      }),
    ).toBe('DUPLICATE');
    expectError(
      () =>
        w.api.gatewayWebhook({ eventId: 'evt_2', jobId: id, amount: 11000, signature: 'forged' }),
      'FORBIDDEN',
    );
    expect(w.api.getJob(w.tokens.customer, id).financials.paid).toBe(11000);
  });

  it('calculates commission from the terms captured on the quotation', () => {
    const w = world();
    const { id } = toDelivered(w);
    // Changing the commission later must not rewrite this job.
    const raw = db(w);
    raw.settings.commissionPct = 40;
    w.storage.save(raw);
    w.api.recordPayment(w.tokens.vendorA, id, {
      method: 'CASH_ON_DELIVERY',
      amount: 11000,
      idempotencyKey: 'cod-commission',
    });
    const f = w.api.getJob(w.tokens.admin, id).financials;
    expect(f.commission).toBe(Math.round(11000 * 0.12) + 100);
    expect(f.vendorEarnings).toBe(11000 - f.commission);
  });

  it('works out who owes whom and settles it', () => {
    const w = world();
    const a = toDelivered(w);
    w.api.recordPayment(w.tokens.vendorA, a.id, {
      method: 'CASH_ON_DELIVERY',
      amount: 11000,
      idempotencyKey: 'bal-1-key',
    });
    const commission = Math.round(11000 * 0.12) + 100;
    let balance = w.api.vendorBalances(w.tokens.admin).find((b) => b.vendorId === 'vendorA')!;
    // Vendor holds all the cash, so it owes the platform the commission.
    expect(balance.balance).toBe(-commission);
    expectError(
      () => w.api.createSettlement(w.tokens.admin, 'vendorA', 500, 'WRONG-DIR'),
      'VALIDATION',
    );
    w.api.createSettlement(w.tokens.admin, 'vendorA', -commission, 'CASH-DEP-1');
    balance = w.api.vendorBalances(w.tokens.admin).find((b) => b.vendorId === 'vendorA')!;
    expect(balance.balance).toBe(0);
    expectError(() => w.api.vendorBalances(w.tokens.vendorA), 'FORBIDDEN');
  });

  it('refunds a disputed job and reverses the commission', () => {
    const w = world();
    const { id } = toDelivered(w);
    w.api.recordPayment(w.tokens.vendorA, id, {
      method: 'CASH_ON_DELIVERY',
      amount: 11000,
      idempotencyKey: 'ref-1-key',
    });
    w.api.raiseComplaint(w.tokens.customer, {
      jobId: id,
      subject: 'Screen stopped working',
      body: 'It broke again after one day.',
      isDispute: true,
    });
    expect(w.api.getJob(w.tokens.customer, id).job.status).toBe('DISPUTED');
    expectError(
      () =>
        w.api.issueRefund(w.tokens.ops, id, {
          amount: 11000,
          reason: 'Faulty part',
          collector: 'PLATFORM',
          idempotencyKey: 'refund-ops',
        }),
      'FORBIDDEN',
    );
    expectError(
      () =>
        w.api.issueRefund(w.tokens.admin, id, {
          amount: 12000,
          reason: 'Faulty part',
          collector: 'PLATFORM',
          idempotencyKey: 'refund-big',
        }),
      'VALIDATION',
    );
    w.api.issueRefund(w.tokens.admin, id, {
      amount: 11000,
      reason: 'Faulty part',
      collector: 'PLATFORM',
      idempotencyKey: 'refund-full',
    });
    const view = w.api.getJob(w.tokens.admin, id);
    expect(view.job.status).toBe('REFUNDED');
    expect(view.financials.commission).toBe(0);
    expect(view.financials.refunded).toBe(11000);
    // The vendor kept the cash but the platform refunded it: the vendor now owes the platform.
    expect(
      w.api.vendorBalances(w.tokens.admin).find((b) => b.vendorId === 'vendorA')!.balance,
    ).toBe(-11000);
  });
});

describe('record-level access', () => {
  it('a customer cannot see another customer’s jobs', () => {
    const w = world();
    const job = w.api.createRequest(w.tokens.customer, request());
    expectError(() => w.api.getJob(w.tokens.other, job.id), 'NOT_FOUND');
    expect(w.api.listJobs(w.tokens.other).items).toEqual([]);
    expectError(() => w.api.cancelJob(w.tokens.other, job.id, 'malicious'), 'FORBIDDEN');
  });

  it('a vendor cannot see another vendor’s jobs, earnings or reviews', () => {
    const w = world();
    const { id } = toApproved(w);
    expectError(() => w.api.getJob(w.tokens.vendorB, id), 'NOT_FOUND');
    expect(w.api.listJobs(w.tokens.vendorB).items).toEqual([]);
    expectError(() => w.api.advance(w.tokens.vendorB, id, 'REPAIR_IN_PROGRESS'), 'CONFLICT');
    expectError(() => w.api.submitQuotation(w.tokens.vendorB, id, quote()), 'NOT_FOUND');
    expect(w.api.vendorDashboard(w.tokens.vendorB).earningsByJob).toEqual([]);
  });

  it('staff only get the permissions they were granted', () => {
    const w = world();
    expect(w.api.listJobs(w.tokens.ops).total).toBe(0);
    expectError(() => w.api.reportData(w.tokens.ops), 'FORBIDDEN');
    expectError(() => w.api.updateSettings(w.tokens.ops, {}), 'VALIDATION');
    expectError(
      () =>
        w.api.createStaff(w.tokens.ops, {
          role: 'STAFF',
          name: 'Evil',
          email: 'e@x.pk',
          phone: '03015555555',
          password: 'abc12345',
          permissions: ['staff.manage'],
        }),
      'FORBIDDEN',
    );
    expectError(() => w.api.auditLog(w.tokens.ops), 'FORBIDDEN');
  });

  it('staff cannot escalate their own permissions', () => {
    const w = world();
    w.api.setPermissions(w.tokens.admin, 'ops', ['jobs.view', 'staff.manage']);
    expectError(
      () =>
        w.api.setPermissions(w.tokens.ops, 'ops', ['jobs.view', 'staff.manage', 'settings.manage']),
      'FORBIDDEN',
    );
  });

  it('files are only readable by the parties to the job', () => {
    const w = world();
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const { id: fileId } = w.api.uploadFile(w.tokens.customer, {
      dataUrl: png,
      mime: 'image/png',
      size: 100,
    });
    w.api.createRequest(w.tokens.customer, request({ photoIds: [fileId] }));
    expect(w.api.file(w.tokens.customer, fileId).mime).toBe('image/png');
    expectError(() => w.api.file(w.tokens.other, fileId), 'FORBIDDEN');
    expectError(() => w.api.file(w.tokens.vendorA, fileId), 'FORBIDDEN');
    expectError(
      () =>
        w.api.uploadFile(w.tokens.customer, {
          dataUrl: 'data:text/html;base64,PGgxPg==',
          mime: 'text/html',
          size: 10,
        }),
      'VALIDATION',
    );
    expectError(
      () => w.api.uploadFile(w.tokens.customer, { dataUrl: png, mime: 'image/jpeg', size: 10 }),
      'VALIDATION',
    );
  });
});

describe('reviews', () => {
  it('allows one review per job, only after delivery, only by the customer', () => {
    const w = world();
    const { id } = toApproved(w);
    expectError(
      () => w.api.addReview(w.tokens.customer, id, { rating: 5, comment: '' }),
      'CONFLICT',
      /once your phone/,
    );
    w.api.advance(w.tokens.vendorA, id, 'REPAIR_IN_PROGRESS');
    w.api.advance(w.tokens.vendorA, id, 'REPAIR_COMPLETED');
    w.api.advance(w.tokens.vendorA, id, 'QUALITY_CHECKED');
    w.api.scheduleDelivery(w.tokens.vendorA, id, {
      date: '2026-10-21',
      window: '18:00-21:00',
      fee: 0,
    });
    w.api.advance(w.tokens.vendorA, id, 'OUT_FOR_DELIVERY');
    w.api.confirmDelivery(
      w.tokens.vendorA,
      id,
      w.api.generateHandoverCode(w.tokens.customer, id).code,
    );
    expectError(
      () => w.api.addReview(w.tokens.other, id, { rating: 1, comment: 'fake' }),
      'NOT_FOUND',
    );
    w.api.addReview(w.tokens.customer, id, { rating: 4, comment: 'Good job' });
    expectError(
      () => w.api.addReview(w.tokens.customer, id, { rating: 5, comment: 'again' }),
      'CONFLICT',
      /already/,
    );
    expect(w.api.vendorDashboard(w.tokens.vendorA).performance.rating).toBe(4);
  });

  it('hidden reviews need a policy note and drop out of the rating', () => {
    const w = world();
    const { id } = toDelivered(w);
    w.api.addReview(w.tokens.customer, id, { rating: 1, comment: 'abuse' });
    const r = w.api.allReviews(w.tokens.admin)[0];
    expectError(() => w.api.moderateReview(w.tokens.admin, r.id, 'HIDDEN', ''), 'VALIDATION');
    w.api.moderateReview(w.tokens.admin, r.id, 'HIDDEN', 'Abusive language');
    expect(w.api.vendorDashboard(w.tokens.vendorA).performance.rating).toBeNull();
  });
});

describe('notifications', () => {
  it('notifies in-app and logs channels without a provider as not configured', () => {
    const w = world();
    w.api.createRequest(w.tokens.customer, request());
    expect(w.api.notifications(w.tokens.vendorA)[0].title).toBe('New job available');
    const log = w.api.deliveryLog(w.tokens.admin);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((l) => l.status === 'PROVIDER_NOT_CONFIGURED')).toBe(true);
  });
});

describe('end-to-end lifecycle', () => {
  it('customer → vendor → agent → payment → settlement → reports', () => {
    const w = world();
    const { id } = toDelivered(w, { agent: true });
    // The platform's agent collected cash on delivery for the platform.
    w.api.recordPayment(w.tokens.agent, id, {
      method: 'CASH_ON_DELIVERY',
      amount: 11000,
      idempotencyKey: 'e2e-cod-1',
    });
    w.api.closeJob(w.tokens.vendorA, id);
    const view = w.api.getJob(w.tokens.customer, id);
    expect(view.job.status).toBe('CLOSED');
    expect(view.warranty?.days).toBe(90);
    expect(view.invoice?.number).toMatch(/^INV-2026-/);
    const f = jobFinancials(view.job, view.quotations, view.transactions);
    expect(f.collectedByPlatform).toBe(11000);
    const balance = w.api.vendorBalances(w.tokens.admin).find((b) => b.vendorId === 'vendorA')!;
    expect(balance.balance).toBe(f.vendorEarnings);
    w.api.createSettlement(w.tokens.admin, 'vendorA', f.vendorEarnings, 'IBFT-E2E');
    const data = w.api.reportData(w.tokens.admin);
    expect(
      vendorBalance('vendorA', data.jobs, data.quotations, data.transactions, data.settlements)
        .balance,
    ).toBe(0);
    expect(data.jobs[0].pickupAddress.line1).toBe('');
  });
});

describe('demo seed', () => {
  it('builds a consistent database through the real workflow', () => {
    const seeded = buildDemoDb(new Date('2026-10-27T09:00:00Z'));
    expect(seeded.jobs.length).toBeGreaterThan(60);
    const statuses = new Set(seeded.jobs.map((j) => j.status));
    for (const s of [
      'AWAITING_VENDOR',
      'AWAITING_APPROVAL',
      'REPAIR_IN_PROGRESS',
      'OUT_FOR_DELIVERY',
      'CLOSED',
      'CANCELLED',
      'DISPUTED',
      'REFUNDED',
      'SUBMITTED',
    ]) {
      expect(statuses.has(s as never)).toBe(true);
    }
    // History chains are unbroken for every job.
    for (const job of seeded.jobs) {
      const h = seeded.history.filter((x) => x.jobId === job.id);
      expect(h[0].from).toBeNull();
      expect(h.at(-1)!.to).toBe(job.status);
    }
    const storage = new MemoryDb();
    storage.save(seeded);
    const api = new Backend(
      storage,
      () => emptyDb(),
      () => new Date('2026-10-27T09:00:00Z'),
    );
    const sara = api.login('sara@example.pk', DEMO_PASSWORD).token;
    expect(api.listJobs(sara, { status: 'AWAITING_APPROVAL' }).total).toBe(1);
    const fixit = api.login('fixit@repairhub.pk', DEMO_PASSWORD).token;
    expect(api.marketplace(fixit).length).toBeGreaterThan(0);
  });
});
