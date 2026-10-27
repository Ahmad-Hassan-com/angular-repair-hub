import { Backend } from './backend';
import { hashSecret, randomHex } from './crypto';
import { Db, DbStorage, emptyDb } from './db';
import {
  Address,
  PaymentMethod,
  Permission,
  PERMISSIONS,
  Role,
  TimeWindow,
  TIME_WINDOWS,
  User,
} from './models';

// Development demo data. Every record created here is flagged `demo: true` and the
// UI labels it as such. Jobs are not written directly: they are driven through the
// real backend endpoints with a simulated clock, so their histories, ledgers and
// balances are exactly what the live workflow would produce.

export { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demo-accounts';
import { DEMO_PASSWORD } from './demo-accounts';

/** Keeps the database as a live object while seeding; serialising on every step would be slow. */
class LiveDb implements DbStorage {
  constructor(public db: Db) {}
  load() {
    return this.db;
  }
  save() {}
}

/** Small deterministic PRNG so the demo data is identical on every reset. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRANDS: [string, string[]][] = [
  ['Samsung', ['Galaxy S24', 'Galaxy S23 Ultra', 'Galaxy A55', 'Galaxy A15']],
  ['Apple', ['iPhone 15 Pro', 'iPhone 14', 'iPhone 13', 'iPhone 11']],
  ['Xiaomi', ['Redmi Note 13', 'Redmi 13C', 'Xiaomi 14T']],
  ['Infinix', ['Hot 40', 'Note 40 Pro', 'Zero 30']],
  ['Tecno', ['Spark 20', 'Camon 30', 'Pova 6']],
  ['Oppo', ['Reno 12', 'A79', 'A18']],
  ['Vivo', ['V30', 'Y36', 'Y17s']],
  ['Realme', ['C67', 'Realme 12 Pro', 'Note 50']],
];

const CATEGORIES: [string, string, number][] = [
  ['Screen replacement', 'smartphone', 3500],
  ['Battery replacement', 'battery_charging_full', 2500],
  ['Charging port', 'power', 1500],
  ['Water damage', 'water_drop', 2000],
  ['Camera repair', 'photo_camera', 3000],
  ['Speaker / microphone', 'volume_up', 1200],
  ['Software / boot issue', 'system_update', 1000],
  ['Back glass', 'crop_portrait', 2500],
];

const AREAS: [string, string][] = [
  ['Gulberg', 'Lahore'],
  ['DHA', 'Lahore'],
  ['Johar Town', 'Lahore'],
  ['Model Town', 'Lahore'],
  ['Bahria Town', 'Lahore'],
  ['Clifton', 'Karachi'],
  ['Gulshan-e-Iqbal', 'Karachi'],
  ['F-7 / F-8', 'Islamabad'],
];

const CUSTOMER_NAMES = [
  'Sara Malik',
  'Usman Tariq',
  'Hina Raza',
  'Ali Hassan',
  'Fatima Noor',
  'Bilal Qureshi',
  'Zainab Akhtar',
  'Hamza Sheikh',
  'Ayesha Siddiqui',
  'Omar Farooq',
  'Mehwish Iqbal',
  'Danish Butt',
  'Iqra Javed',
  'Saad Mirza',
];

const ISSUES: Record<string, string[]> = {
  'Screen replacement': [
    'Screen cracked after a fall; touch not working in the top half.',
    'Green lines across the display and flickering.',
  ],
  'Battery replacement': [
    'Battery drains from 100% to 20% in three hours.',
    'Phone switches off at 30% and the back is bulging slightly.',
  ],
  'Charging port': [
    'Charges only when the cable is held at an angle.',
    'Not charging at all; port looks loose.',
  ],
  'Water damage': [
    'Fell in water yesterday; turns on but no sound.',
    'Got wet in the rain, now the screen has spots.',
  ],
  'Camera repair': [
    'Rear camera is blurry and will not focus.',
    'Front camera shows a black screen.',
  ],
  'Speaker / microphone': [
    'Callers cannot hear me clearly.',
    'Earpiece is very quiet during calls.',
  ],
  'Software / boot issue': [
    'Stuck on the logo after an update.',
    'Restarts by itself every few minutes.',
  ],
  'Back glass': ['Back glass shattered; want it replaced.', 'Cracked back panel near the camera.'],
};

const PARTS: Record<string, [string, number, number]> = {
  // part name, part price, labour
  'Screen replacement': ['Display assembly', 9000, 1500],
  'Battery replacement': ['Battery', 3500, 800],
  'Charging port': ['Charging port flex', 1200, 900],
  'Water damage': ['Board cleaning and speaker', 1800, 2200],
  'Camera repair': ['Rear camera module', 5500, 1200],
  'Speaker / microphone': ['Microphone module', 900, 800],
  'Software / boot issue': ['Firmware reflash', 0, 1500],
  'Back glass': ['Back glass panel', 2500, 1200],
};

function makeUser(
  db: Db,
  role: Role,
  name: string,
  email: string,
  phone: string,
  createdAt: string,
  permissions: Permission[] = [],
): User {
  const salt = randomHex(16);
  db.seq += 1;
  const user: User = {
    id: `usr_${db.seq}`,
    role,
    name,
    email,
    phone,
    phoneVerified: true,
    passwordHash: hashSecret(DEMO_PASSWORD, salt),
    salt,
    status: 'ACTIVE',
    permissions,
    createdAt,
    failedLogins: 0,
    demo: true,
  };
  db.users.push(user);
  return user;
}

export function buildDemoDb(now = new Date()): Db {
  const random = rng(20261027);
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  let clock = now.getTime() - 120 * DAY;
  const iso = (ms: number) => new Date(ms).toISOString();

  // ---------- Catalogue ----------
  const db = emptyDb();
  for (const [name, models] of BRANDS) {
    const brandId = `bra_${name.toLowerCase()}`;
    db.brands.push({ id: brandId, name, active: true });
    for (const m of models)
      db.models.push({
        id: `mod_${m.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        brandId,
        name: m,
      });
  }
  CATEGORIES.forEach(([name, icon, fromPrice], i) =>
    db.categories.push({ id: `cat_${i + 1}`, name, icon, fromPrice, active: true }),
  );
  AREAS.forEach(([name, city], i) =>
    db.areas.push({ id: `are_${i + 1}`, name, city, active: true }),
  );
  const area = (name: string) => db.areas.find((a) => a.name === name)!.id;
  const lahore = ['Gulberg', 'DHA', 'Johar Town', 'Model Town', 'Bahria Town'].map(area);

  // ---------- People ----------
  const start = iso(clock - 30 * DAY);
  makeUser(db, 'SUPER_ADMIN', 'Ayesha Khan', 'admin@repairhub.pk', '+923001110001', start, [
    ...PERMISSIONS,
  ]);
  makeUser(db, 'STAFF', 'Kamran Ali', 'ops@repairhub.pk', '+923001110002', start, [
    'jobs.view',
    'jobs.assign',
    'jobs.cancel',
    'deliveries.manage',
    'complaints.manage',
    'payments.verify',
    'reports.view',
  ]);
  const rider = makeUser(db, 'AGENT', 'Bilal Ahmed', 'rider@repairhub.pk', '+923001110003', start);

  const vendorSpecs = [
    {
      email: 'fixit@repairhub.pk',
      owner: 'Imran Sheikh',
      shop: 'FixIt Mobile Lab',
      home: 'Gulberg',
      areas: lahore,
      cats: db.categories.map((c) => c.id),
      brands: db.brands.map((b) => b.id),
      status: 'APPROVED' as const,
    },
    {
      email: 'techcare@repairhub.pk',
      owner: 'Nadia Hussain',
      shop: 'TechCare Repairs',
      home: 'Johar Town',
      areas: [area('Johar Town'), area('DHA'), area('Model Town'), area('Gulberg')],
      cats: ['cat_1', 'cat_2', 'cat_3', 'cat_5', 'cat_8'],
      brands: ['bra_samsung', 'bra_apple', 'bra_xiaomi', 'bra_oppo', 'bra_vivo'],
      status: 'APPROVED' as const,
    },
    {
      email: 'mobimed@repairhub.pk',
      owner: 'Faisal Memon',
      shop: 'MobiMed Clinic',
      home: 'Clifton',
      areas: [area('Clifton'), area('Gulshan-e-Iqbal')],
      cats: db.categories.map((c) => c.id),
      brands: db.brands.map((b) => b.id),
      status: 'APPROVED' as const,
    },
    {
      email: 'quickfix@repairhub.pk',
      owner: 'Rizwan Akram',
      shop: 'QuickFix Point',
      home: 'F-7 / F-8',
      areas: [area('F-7 / F-8')],
      cats: ['cat_1', 'cat_2', 'cat_3'],
      brands: ['bra_samsung', 'bra_infinix', 'bra_tecno'],
      status: 'PENDING' as const,
    },
  ];
  const vendors = vendorSpecs.map((spec, i) => {
    const u = makeUser(
      db,
      'VENDOR',
      spec.owner,
      spec.email,
      `+92300222000${i + 1}`,
      iso(clock - (25 - i) * DAY),
    );
    db.vendors.push({
      userId: u.id,
      shopName: spec.shop,
      ownerName: spec.owner,
      address: {
        line1: `Shop ${12 + i}, Hafeez Centre`,
        area: area(spec.home),
        city: db.areas.find((a) => a.id === area(spec.home))!.city,
      },
      serviceAreas: spec.areas,
      specialties: spec.cats,
      brands: spec.brands,
      documents: [],
      payout: {
        bankName: 'Meezan Bank',
        accountTitle: spec.shop,
        iban: `PK36MEZN000${i}0123456789012`.slice(0, 24),
      },
      termsAcceptedAt: u.createdAt,
      status: spec.status,
      available: true,
      hours: { days: [1, 2, 3, 4, 5, 6], open: '10:00', close: '21:00' },
      approvedAt: spec.status === 'APPROVED' ? iso(clock - (20 - i) * DAY) : undefined,
      bio:
        spec.status === 'APPROVED'
          ? `${spec.shop} has repaired phones in ${db.areas.find((a) => a.id === area(spec.home))!.city} for over 8 years. Genuine and high-grade parts with written warranty.`
          : undefined,
    });
    return u;
  });
  const [fixit, techcare, mobimed] = vendors;

  const customers = CUSTOMER_NAMES.map((name, i) => {
    const first = name.split(' ')[0].toLowerCase();
    const home =
      i < 10 ? lahore[i % lahore.length] : pick([area('Clifton'), area('Gulshan-e-Iqbal')]);
    const u = makeUser(
      db,
      'CUSTOMER',
      name,
      `${first}@example.pk`,
      `+9233312340${String(i).padStart(2, '0')}`,
      iso(clock - (10 - i / 2) * DAY),
    );
    const address: Address = {
      line1: `House ${20 + i * 7}, Street ${3 + (i % 9)}`,
      area: home,
      city: db.areas.find((a) => a.id === home)!.city,
    };
    db.customers.push({ userId: u.id, addresses: [address] });
    return { user: u, address };
  });

  // ---------- Drive the real workflow ----------
  const storage = new LiveDb(db);
  const api = new Backend(
    storage,
    () => db,
    () => new Date(clock),
  );
  // Sessions last 7 days, and the simulated clock moves over months, so sign in again as needed.
  const tokens = new Map<string, { token: string; at: number }>();
  const token = (u: User) => {
    const t = tokens.get(u.id);
    if (t && Math.abs(clock - t.at) < DAY) return t.token;
    const fresh = { token: api.login(u.email, DEMO_PASSWORD).token, at: clock };
    tokens.set(u.id, fresh);
    return fresh.token;
  };
  const admin = db.users[0];
  const tick = (minH: number, maxH: number) => (clock += (minH + random() * (maxH - minH)) * HOUR);
  const today = () => iso(clock).slice(0, 10);
  const plusDays = (d: number) => iso(clock + d * DAY).slice(0, 10);

  type Stop =
    | 'AWAITING_VENDOR'
    | 'VENDOR_ACCEPTED'
    | 'PICKUP_SCHEDULED'
    | 'PICKUP_IN_PROGRESS'
    | 'RECEIVED_AT_SHOP'
    | 'INSPECTION_IN_PROGRESS'
    | 'AWAITING_APPROVAL'
    | 'REPAIR_IN_PROGRESS'
    | 'WAITING_FOR_PARTS'
    | 'READY_FOR_DELIVERY'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'PAID'
    | 'CLOSED';
  interface Plan {
    customer: (typeof customers)[number];
    vendor: User;
    stop: Stop;
    reject?: boolean;
    unrepairable?: boolean;
    cancel?: boolean;
    pickupFails?: boolean;
    revise?: boolean;
    agent?: boolean;
    method?: PaymentMethod;
    review?: number;
    dispute?: 'refund' | 'open';
    late?: boolean;
    categoryIndex?: number;
    brand?: string;
  }

  const ORDER: Stop[] = [
    'AWAITING_VENDOR',
    'VENDOR_ACCEPTED',
    'PICKUP_SCHEDULED',
    'PICKUP_IN_PROGRESS',
    'RECEIVED_AT_SHOP',
    'INSPECTION_IN_PROGRESS',
    'AWAITING_APPROVAL',
    'REPAIR_IN_PROGRESS',
    'WAITING_FOR_PARTS',
    'READY_FOR_DELIVERY',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'PAID',
    'CLOSED',
  ];
  const reached = (plan: Plan, s: Stop) => ORDER.indexOf(plan.stop) >= ORDER.indexOf(s);

  function run(plan: Plan): string {
    // The simulated clock jumps between jobs; start each one with clean rate-limit windows.
    db.rateLimits = {};
    const vendorProfile = db.vendors.find((v) => v.userId === plan.vendor.id)!;
    const cat =
      plan.categoryIndex !== undefined
        ? db.categories[plan.categoryIndex]
        : (() => {
            const id = pick(vendorProfile.specialties);
            return db.categories.find((c) => c.id === id)!;
          })();
    const brandId = plan.brand ?? pick(vendorProfile.brands);
    const model = pick(db.models.filter((m) => m.brandId === brandId));
    const addr = {
      ...plan.customer.address,
      area: vendorProfile.serviceAreas.includes(plan.customer.address.area)
        ? plan.customer.address.area
        : vendorProfile.serviceAreas[0],
    };
    const c = token(plan.customer.user);
    const v = token(plan.vendor);
    const job = api.createRequest(c, {
      brandId,
      modelId: model.id,
      categoryId: cat.id,
      description: pick(ISSUES[cat.name]),
      photoIds: [],
      pickupAddress: addr,
      deliveryAddress: addr,
      preferredPickupDate: plusDays(1),
      preferredPickupWindow: pick(TIME_WINDOWS) as TimeWindow,
      diagnosticConsent: random() < 0.8,
    });
    const id = job.id;
    if (plan.cancel) {
      tick(1, 10);
      api.cancelJob(
        c,
        id,
        pick(['Found a shop nearby', 'Phone started working again', 'Price too high for me']),
      );
      return id;
    }
    if (!reached(plan, 'VENDOR_ACCEPTED')) return id;
    tick(0.2, 3);
    api.acceptJob(v, id);
    if (!reached(plan, 'PICKUP_SCHEDULED')) return id;
    tick(0.5, 4);
    const window = pick(TIME_WINDOWS) as TimeWindow;
    const assignee = plan.agent ? rider.id : undefined;
    const pickupDay = plusDays(random() < 0.5 ? 0 : 1);
    api.schedulePickup(v, id, {
      date: pickupDay,
      window,
      fee: db.settings.defaultPickupFee,
      assigneeId: assignee,
    });
    if (!reached(plan, 'PICKUP_IN_PROGRESS')) return id;
    const courier = plan.agent ? token(rider) : v;
    clock = Math.max(clock, Date.parse(`${pickupDay}T05:00:00Z`)) + random() * 6 * HOUR;
    api.advance(courier, id, 'PICKUP_IN_PROGRESS');
    if (plan.pickupFails) {
      tick(0.5, 1);
      api.advance(
        courier,
        id,
        'CUSTOMER_UNAVAILABLE',
        'Customer did not answer the door or phone.',
      );
      tick(2, 6);
      api.schedulePickup(v, id, {
        date: plusDays(1),
        window,
        fee: db.settings.defaultPickupFee,
        assigneeId: assignee,
        note: 'Rebooked with customer.',
      });
      tick(18, 26);
      api.advance(courier, id, 'PICKUP_IN_PROGRESS');
    }
    if (plan.stop === 'PICKUP_IN_PROGRESS') return id;
    tick(0.3, 1.5);
    const otp = api.generateHandoverCode(c, id).code;
    api.confirmCollection(courier, id, otp, {
      physicalCondition: pick(['GOOD', 'FAIR', 'GOOD', 'POOR']),
      existingDamage: pick([
        'Minor scratches on the frame',
        'Dent on the bottom-left corner',
        'None visible',
        'Cracked screen protector',
      ]),
      accessories: random() < 0.4 ? ['Case'] : [],
      imei:
        random() < 0.6
          ? String(350000000000000 + Math.floor(random() * 99999999999)).slice(0, 15)
          : undefined,
      powersOn: cat.name !== 'Software / boot issue' && random() < 0.85,
      photoIds: [],
    });
    tick(0.5, 2);
    api.advance(v, id, 'RECEIVED_AT_SHOP');
    if (plan.stop === 'RECEIVED_AT_SHOP') return id;
    tick(0.5, 4);
    api.advance(v, id, 'INSPECTION_IN_PROGRESS');
    if (plan.stop === 'INSPECTION_IN_PROGRESS') return id;
    tick(1, 6);
    if (plan.unrepairable) {
      api.markUnrepairable(
        v,
        id,
        'Motherboard is corroded beyond repair; data could not be recovered.',
      );
    } else {
      const [partName, partPrice, labour] = PARTS[cat.name];
      const jitter = (n: number) => Math.round((n * (0.8 + random() * 0.6)) / 50) * 50;
      const items = [
        ...(partPrice
          ? [
              {
                type: 'PART' as const,
                description: partName,
                quantity: 1,
                unitPrice: jitter(partPrice),
              },
            ]
          : []),
        { type: 'LABOR' as const, description: 'Labour', quantity: 1, unitPrice: jitter(labour) },
        {
          type: 'DELIVERY' as const,
          description: 'Pickup and delivery',
          quantity: 1,
          unitPrice: db.settings.defaultPickupFee + db.settings.defaultDeliveryFee,
        },
      ];
      api.submitQuotation(v, id, {
        findings: `Confirmed: ${pick(ISSUES[cat.name]).toLowerCase()}`,
        proposedRepair: `Replace ${partName.toLowerCase()} and test all functions.`,
        items,
        discount: random() < 0.2 ? 300 : 0,
        estimatedCompletion: plusDays(plan.late ? 1 : 2 + Math.floor(random() * 2)),
        warrantyDays: partPrice ? pick([30, 60, 90]) : 0,
      });
      if (plan.stop === 'AWAITING_APPROVAL') return id;
      tick(1, 10);
      const quote = db.quotations.filter((q) => q.jobId === id).at(-1)!;
      if (plan.reject) {
        api.respondToQuotation(
          c,
          id,
          quote.id,
          false,
          pick(['Too expensive; I will buy a new phone.', 'I will get it fixed later.']),
        );
      } else {
        api.respondToQuotation(c, id, quote.id, true);
        tick(0.5, 3);
        api.advance(v, id, 'REPAIR_IN_PROGRESS');
        api.addWorkLog(v, id, 'BEFORE', 'Opened the device; damage matches the inspection.');
        if (plan.revise) {
          tick(2, 6);
          api.submitQuotation(v, id, {
            findings: 'Found a damaged flex cable while replacing the part.',
            proposedRepair: 'Also replace the connecting flex cable.',
            items: [
              ...quote.items,
              { type: 'PART', description: 'Connector flex cable', quantity: 1, unitPrice: 1200 },
            ],
            discount: quote.discount,
            estimatedCompletion: plusDays(2),
            warrantyDays: quote.warrantyDays,
          });
          tick(1, 5);
          api.respondToQuotation(
            c,
            id,
            db.quotations.filter((q) => q.jobId === id).at(-1)!.id,
            true,
          );
          api.advance(v, id, 'REPAIR_IN_PROGRESS');
        }
        if (plan.stop === 'REPAIR_IN_PROGRESS') return id;
        if (plan.stop === 'WAITING_FOR_PARTS') {
          tick(1, 3);
          api.advance(
            v,
            id,
            'WAITING_FOR_PARTS',
            'Original part is on order from the distributor; expected in 2 days.',
          );
          return id;
        }
        tick(plan.late ? 40 : 3, plan.late ? 60 : 20);
        if (partPrice)
          api.addPart(v, id, { partName, quantity: 1, unitCost: Math.round(partPrice * 0.7) });
        api.advance(v, id, 'REPAIR_COMPLETED');
        api.addWorkLog(v, id, 'AFTER', 'Repair finished; all functions tested.');
        tick(0.3, 2);
        api.advance(v, id, 'QUALITY_CHECKED');
      }
    }
    tick(0.5, 4);
    api.scheduleDelivery(v, id, {
      date: today(),
      window: pick(TIME_WINDOWS) as TimeWindow,
      fee: db.settings.defaultDeliveryFee,
      assigneeId: assignee,
    });
    if (plan.stop === 'READY_FOR_DELIVERY') return id;
    tick(1, 5);
    api.advance(courier, id, 'OUT_FOR_DELIVERY');
    if (plan.stop === 'OUT_FOR_DELIVERY') return id;
    tick(0.5, 2);
    api.confirmDelivery(courier, id, api.generateHandoverCode(c, id).code);
    const f = () => api.getJob(c, id).financials;
    if (plan.stop === 'DELIVERED' || f().outstanding === 0) return finish(plan, id, c);
    const method =
      plan.method ??
      (plan.agent
        ? 'CASH_ON_DELIVERY'
        : pick<PaymentMethod>([
            'CASH_ON_DELIVERY',
            'CASH_TO_VENDOR',
            'CASH_ON_DELIVERY',
            'BANK_TRANSFER',
          ]));
    const payer = method === 'BANK_TRANSFER' ? token(admin) : courier;
    api.recordPayment(payer, id, {
      method,
      amount: f().outstanding,
      reference: method === 'BANK_TRANSFER' ? `IBFT-${Math.floor(random() * 1e6)}` : undefined,
      idempotencyKey: `seed-${id}`,
    });
    return finish(plan, id, c);
  }

  function finish(plan: Plan, id: string, c: string): string {
    if (plan.review) {
      tick(2, 30);
      api.addReview(c, id, {
        rating: plan.review,
        comment: pick(
          plan.review >= 4
            ? [
                'Quick pickup and the phone works like new.',
                'Clear quotation, no surprises. Recommended.',
                'Very professional, kept me updated throughout.',
              ]
            : [
                'Repair was fine but took longer than promised.',
                'Okay service, communication could be better.',
              ],
        ),
      });
    }
    const status = db.jobs.find((j) => j.id === id)!.status;
    if (plan.dispute && (status === 'PAID' || status === 'CLOSED')) {
      tick(5, 30);
      api.raiseComplaint(c, {
        jobId: id,
        subject: 'Same problem came back after two days',
        body: 'The issue returned two days after delivery. I want a refund or a proper fix.',
        isDispute: true,
      });
      if (plan.dispute === 'refund') {
        tick(5, 24);
        const paid = api.getJob(c, id).financials.paid;
        api.issueRefund(token(admin), id, {
          amount: paid,
          reason: 'Repair failed within warranty; customer refunded.',
          collector: 'PLATFORM',
          idempotencyKey: `seed-refund-${id}`,
        });
      }
      return id;
    }
    if (plan.stop === 'CLOSED' && status === 'PAID') {
      tick(1, 24);
      api.closeJob(token(plan.vendor), id);
    }
    return id;
  }

  // Historical jobs spread over the last ~110 days.
  const lahoreCustomers = customers.slice(1, 10);
  const karachiCustomers = customers.slice(10);
  for (let i = 0; i < 46; i++) {
    clock = now.getTime() - (112 - i * 2.2) * DAY + random() * 10 * HOUR;
    const karachi = i % 6 === 5;
    const vendor = karachi ? mobimed : random() < 0.6 ? fixit : techcare;
    const customer = karachi ? pick(karachiCustomers) : pick(lahoreCustomers);
    const roll = random();
    const plan: Plan = {
      customer,
      vendor,
      stop: 'CLOSED',
      agent: random() < 0.3,
      review: random() < 0.7 ? pick([5, 5, 4, 4, 4, 3, 5, 2]) : undefined,
      revise: random() < 0.1,
      pickupFails: random() < 0.08,
      late: random() < 0.15,
    };
    if (roll < 0.08) Object.assign(plan, { cancel: true, review: undefined });
    else if (roll < 0.15) Object.assign(plan, { reject: true });
    else if (roll < 0.19) Object.assign(plan, { unrepairable: true, review: undefined });
    else if (roll < 0.23) plan.stop = 'PAID';
    if (i === 20) Object.assign(plan, { dispute: 'refund', review: 2, stop: 'CLOSED' });
    run(plan);
  }

  // Recent and in-flight jobs for the demo accounts.
  const sara = customers[0];
  const recent: [number, Plan][] = [
    [
      9,
      {
        customer: sara,
        vendor: fixit,
        stop: 'CLOSED',
        review: 5,
        categoryIndex: 1,
        brand: 'bra_samsung',
      },
    ],
    [6, { customer: sara, vendor: techcare, stop: 'PAID', categoryIndex: 2, brand: 'bra_apple' }],
    [3, { customer: customers[2], vendor: fixit, stop: 'CLOSED', dispute: 'open' }],
    [10, { customer: customers[3], vendor: fixit, stop: 'REPAIR_IN_PROGRESS', late: true }],
    [5, { customer: customers[4], vendor: techcare, stop: 'WAITING_FOR_PARTS' }],
    [2.5, { customer: customers[5], vendor: fixit, stop: 'READY_FOR_DELIVERY' }],
    [2, { customer: customers[6], vendor: fixit, stop: 'OUT_FOR_DELIVERY', agent: true }],
    [
      1.6,
      { customer: customers[7], vendor: techcare, stop: 'DELIVERED', method: 'CASH_ON_DELIVERY' },
    ],
    [1.4, { customer: customers[8], vendor: fixit, stop: 'INSPECTION_IN_PROGRESS' }],
    [1.2, { customer: customers[11], vendor: mobimed, stop: 'REPAIR_IN_PROGRESS' }],
    [
      1.1,
      {
        customer: sara,
        vendor: fixit,
        stop: 'AWAITING_APPROVAL',
        categoryIndex: 0,
        brand: 'bra_samsung',
      },
    ],
    [0.9, { customer: customers[9], vendor: fixit, stop: 'PICKUP_IN_PROGRESS', agent: true }],
    [
      0.7,
      {
        customer: sara,
        vendor: techcare,
        stop: 'PICKUP_SCHEDULED',
        categoryIndex: 1,
        brand: 'bra_apple',
      },
    ],
    [0.5, { customer: customers[1], vendor: techcare, stop: 'VENDOR_ACCEPTED' }],
    [0.3, { customer: customers[2], vendor: fixit, stop: 'AWAITING_VENDOR', categoryIndex: 4 }],
    [0.15, { customer: customers[4], vendor: fixit, stop: 'AWAITING_VENDOR', categoryIndex: 6 }],
    [0.1, { customer: customers[12], vendor: mobimed, stop: 'AWAITING_VENDOR' }],
  ];
  for (const [daysAgo, plan] of recent) {
    clock = now.getTime() - daysAgo * DAY;
    run(plan);
  }

  // One request waiting for an admin to assign it (shows mode B without switching modes).
  clock = now.getTime() - 3 * HOUR;
  const queued = api.createRequest(token(customers[3].user), {
    brandId: 'bra_infinix',
    modelId: db.models.find((m) => m.brandId === 'bra_infinix')!.id,
    categoryId: 'cat_4',
    description: 'Dropped in a bucket of water; screen stays black but it vibrates.',
    photoIds: [],
    pickupAddress: customers[3].address,
    deliveryAddress: customers[3].address,
    preferredPickupDate: plusDays(1),
    preferredPickupWindow: '15:00-18:00',
    diagnosticConsent: true,
  });
  // Return it to the queue as if no vendor had taken it yet.
  const qjob = db.jobs.find((j) => j.id === queued.id)!;
  db.history.push({
    id: `hist_${++db.seq}`,
    jobId: qjob.id,
    from: 'AWAITING_VENDOR',
    to: 'SUBMITTED',
    actorId: admin.id,
    at: iso(clock + 60_000),
    note: 'Held for manual assignment: water damage on a budget phone.',
  });
  qjob.status = 'SUBMITTED';
  qjob.version += 1;

  // Settlements: FixIt was paid out part of its balance a week ago.
  clock = now.getTime() - 7 * DAY;
  const fixitBalance = api
    .vendorBalances(token(admin))
    .find((b) => b.vendorId === fixit.id)!.balance;
  if (fixitBalance !== 0)
    api.createSettlement(token(admin), fixit.id, Math.round(fixitBalance / 2), 'IBFT-778812');
  const techBalance = api
    .vendorBalances(token(admin))
    .find((b) => b.vendorId === techcare.id)!.balance;
  if (techBalance !== 0)
    api.createSettlement(token(admin), techcare.id, techBalance, 'IBFT-778813');

  // A general complaint from a customer.
  clock = now.getTime() - 2 * DAY;
  api.raiseComplaint(token(customers[5].user), {
    subject: 'Courier arrived outside the time window',
    body: 'The rider came at 9pm although I chose 3-6pm. Please make sure this does not happen again.',
  });

  // Tidy up: no live sessions, old notifications read, everything flagged as demo.
  const cutoff = iso(now.getTime() - 2 * DAY);
  db.sessions = [];
  db.rateLimits = {};
  for (const n of db.notifications) if (n.at < cutoff) n.read = true;
  for (const j of db.jobs) j.demo = true;
  return db;
}
