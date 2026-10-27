import {
  AuditLog,
  Complaint,
  CustomerProfile,
  DeliveryLogEntry,
  DeviceConditionReport,
  Invoice,
  Notification,
  PaymentTransaction,
  PhoneBrand,
  PhoneModel,
  PickupDeliveryTask,
  RepairAssignment,
  RepairCategory,
  RepairInspection,
  RepairJob,
  RepairPartUsage,
  RepairQuotation,
  RepairWorkLog,
  Review,
  ServiceArea,
  Session,
  StatusHistoryEntry,
  SystemSettings,
  UploadedFile,
  User,
  VendorProfile,
  VendorSettlement,
  Warranty,
} from './models';

export const SCHEMA_VERSION = 3;

/**
 * The whole database as one document. Each array is a table; ids are foreign keys.
 * Unique constraints (one accepted assignment per job, one review per job, unique
 * idempotency keys, unique emails) are enforced by the backend inside transactions.
 */
export interface Db {
  schemaVersion: number;
  seq: number;
  users: User[];
  sessions: Session[];
  customers: CustomerProfile[];
  vendors: VendorProfile[];
  brands: PhoneBrand[];
  models: PhoneModel[];
  categories: RepairCategory[];
  areas: ServiceArea[];
  jobs: RepairJob[];
  history: StatusHistoryEntry[];
  assignments: RepairAssignment[];
  tasks: PickupDeliveryTask[];
  conditions: DeviceConditionReport[];
  inspections: RepairInspection[];
  quotations: RepairQuotation[];
  parts: RepairPartUsage[];
  workLogs: RepairWorkLog[];
  transactions: PaymentTransaction[];
  settlements: VendorSettlement[];
  invoices: Invoice[];
  warranties: Warranty[];
  reviews: Review[];
  complaints: Complaint[];
  notifications: Notification[];
  deliveryLog: DeliveryLogEntry[];
  files: UploadedFile[];
  audit: AuditLog[];
  settings: SystemSettings;
  /** Server-only secrets. Never returned by any endpoint. */
  secrets: { gatewayWebhookSecret?: string };
  /** Short-lived phone verification codes (hashed). */
  phoneCodes: { userId: string; hash: string; salt: string; expiresAt: string; attempts: number }[];
  /** Sliding-window counters for rate limiting: key -> attempt timestamps (ms). */
  rateLimits: Record<string, number[]>;
}

export interface DbStorage {
  load(): Db | null;
  save(db: Db): void;
}

export const DB_KEY = 'repairhub.db';

/** localStorage persistence. Every transaction re-reads it, so two tabs stay consistent. */
export class LocalStorageDb implements DbStorage {
  load(): Db | null {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return null;
      const db = JSON.parse(raw) as Db;
      return db.schemaVersion === SCHEMA_VERSION ? db : null;
    } catch {
      return null;
    }
  }

  save(db: Db): void {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      throw new Error('Browser storage is full. Remove some photos or reset the demo data.');
    }
  }
}

/** In-memory storage for tests. Stores a serialised copy so callers can't mutate it by reference. */
export class MemoryDb implements DbStorage {
  private raw: string | null = null;
  load(): Db | null {
    return this.raw ? (JSON.parse(this.raw) as Db) : null;
  }
  save(db: Db): void {
    this.raw = JSON.stringify(db);
  }
}

export function defaultSettings(): SystemSettings {
  return {
    assignmentMode: 'FIRST_ACCEPT',
    acceptanceTimeoutHours: 4,
    commissionPct: 12,
    commissionFixed: 100,
    taxRatePct: 0,
    defaultPickupFee: 250,
    defaultDeliveryFee: 250,
    diagnosticFee: 500,
    otpTtlMinutes: 30,
    otpMaxAttempts: 5,
    customerCancellable: [
      'SUBMITTED',
      'AWAITING_VENDOR',
      'VENDOR_ACCEPTED',
      'PICKUP_SCHEDULED',
      'PICKUP_FAILED',
    ],
    enabledPaymentMethods: ['CASH_ON_DELIVERY', 'CASH_TO_VENDOR', 'BANK_TRANSFER'],
    providers: {
      EMAIL: { configured: false, label: 'SMTP / SendGrid' },
      SMS: { configured: false, label: 'SMS gateway' },
      WHATSAPP: { configured: false, label: 'WhatsApp Business API' },
    },
    onlineGateway: { configured: false, label: 'Card / wallet gateway' },
    reviewPolicy:
      'Reviews are hidden only if they contain abuse, personal data, or are unrelated to the repair. Ratings are never edited.',
  };
}

export function emptyDb(): Db {
  return {
    schemaVersion: SCHEMA_VERSION,
    seq: 1000,
    users: [],
    sessions: [],
    customers: [],
    vendors: [],
    brands: [],
    models: [],
    categories: [],
    areas: [],
    jobs: [],
    history: [],
    assignments: [],
    tasks: [],
    conditions: [],
    inspections: [],
    quotations: [],
    parts: [],
    workLogs: [],
    transactions: [],
    settlements: [],
    invoices: [],
    warranties: [],
    reviews: [],
    complaints: [],
    notifications: [],
    deliveryLog: [],
    files: [],
    audit: [],
    settings: defaultSettings(),
    secrets: {},
    phoneCodes: [],
    rateLimits: {},
  };
}
