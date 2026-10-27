// Domain model for Mobile Repair Hub. The in-browser backend (backend.ts) persists
// these records as one normalised "database" document; see docs/ARCHITECTURE.md.

export type Id = string;
/** ISO-8601 timestamp (UTC). Reports bucket these in Asia/Karachi. */
export type Iso = string;
/** Whole Pakistani rupees. Money is always an integer to avoid float drift. */
export type Pkr = number;

// ---------- Identity and access ----------

export type Role = 'SUPER_ADMIN' | 'STAFF' | 'VENDOR' | 'CUSTOMER' | 'AGENT';

/** Granular permissions. Super admins implicitly hold all of them; staff hold what they are given. */
export const PERMISSIONS = [
  'jobs.view',
  'jobs.assign',
  'jobs.cancel',
  'deliveries.manage',
  'vendors.manage',
  'customers.manage',
  'payments.verify',
  'refunds.issue',
  'settlements.manage',
  'complaints.manage',
  'reviews.moderate',
  'reports.view',
  'catalog.manage',
  'settings.manage',
  'staff.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface User {
  id: Id;
  role: Role;
  name: string;
  email: string;
  /** +92XXXXXXXXXX */
  phone: string;
  phoneVerified: boolean;
  passwordHash: string;
  salt: string;
  status: AccountStatus;
  permissions: Permission[];
  createdAt: Iso;
  lastLoginAt?: Iso;
  failedLogins: number;
  lockedUntil?: Iso;
  demo?: boolean;
}

/** User without credentials: the only shape the API ever returns. */
export type PublicUser = Omit<User, 'passwordHash' | 'salt' | 'failedLogins' | 'lockedUntil'>;

export interface Session {
  token: string;
  userId: Id;
  createdAt: Iso;
  expiresAt: Iso;
}

export interface Address {
  line1: string;
  area: Id;
  city: string;
  landmark?: string;
}

export interface CustomerProfile {
  userId: Id;
  addresses: Address[];
}

export type VendorStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface WorkingHours {
  /** 0 = Sunday */
  days: number[];
  open: string; // HH:mm
  close: string;
}

export interface VendorProfile {
  userId: Id;
  shopName: string;
  ownerName: string;
  address: Address;
  serviceAreas: Id[];
  specialties: Id[]; // RepairCategory ids
  brands: Id[]; // PhoneBrand ids
  documents: VendorDocument[];
  payout?: { bankName: string; accountTitle: string; iban: string };
  termsAcceptedAt: Iso;
  status: VendorStatus;
  statusReason?: string;
  available: boolean;
  hours: WorkingHours;
  approvedAt?: Iso;
  bio?: string;
}

export interface VendorDocument {
  kind: 'CNIC' | 'BUSINESS_REGISTRATION' | 'OTHER';
  fileId: Id;
  uploadedAt: Iso;
}

// ---------- Catalogue ----------

export interface PhoneBrand {
  id: Id;
  name: string;
  active: boolean;
}
export interface PhoneModel {
  id: Id;
  brandId: Id;
  name: string;
}
export interface RepairCategory {
  id: Id;
  name: string;
  icon: string;
  /** Indicative starting price shown to customers; never used for billing. */
  fromPrice: Pkr;
  active: boolean;
}
export interface ServiceArea {
  id: Id;
  name: string;
  city: string;
  active: boolean;
}

// ---------- Repair jobs ----------

export type JobStatus =
  | 'SUBMITTED'
  | 'AWAITING_VENDOR'
  | 'VENDOR_ACCEPTED'
  | 'PICKUP_SCHEDULED'
  | 'PICKUP_IN_PROGRESS'
  | 'PHONE_COLLECTED'
  | 'RECEIVED_AT_SHOP'
  | 'INSPECTION_IN_PROGRESS'
  | 'QUOTATION_SUBMITTED'
  | 'AWAITING_APPROVAL'
  | 'QUOTATION_APPROVED'
  | 'REPAIR_IN_PROGRESS'
  | 'WAITING_FOR_PARTS'
  | 'REPAIR_COMPLETED'
  | 'QUALITY_CHECKED'
  | 'READY_FOR_DELIVERY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'PAID'
  | 'CLOSED'
  // Controlled alternative states
  | 'CANCELLED'
  | 'PICKUP_FAILED'
  | 'CUSTOMER_UNAVAILABLE'
  | 'QUOTATION_REJECTED'
  | 'UNREPAIRABLE'
  | 'RETURNED_WITHOUT_REPAIR'
  | 'DISPUTED'
  | 'REFUNDED';

/** Whether the phone ends up repaired. Decides the path after delivery. */
export type JobOutcome = 'PENDING' | 'REPAIRED' | 'NOT_REPAIRED';

export interface RepairJob {
  id: Id;
  /** Human-friendly reference, e.g. MRH-10042 */
  ref: string;
  customerId: Id;
  vendorId?: Id;
  agentId?: Id;
  brandId: Id;
  modelId: Id;
  categoryId: Id;
  description: string;
  photoIds: Id[];
  pickupAddress: Address;
  deliveryAddress: Address;
  preferredPickupDate: string; // YYYY-MM-DD
  preferredPickupWindow: TimeWindow;
  diagnosticConsent: boolean;
  /** Diagnostic fee at the time of the request, charged only if the job is not repaired. */
  diagnosticFee: Pkr;
  status: JobStatus;
  outcome: JobOutcome;
  /** Optimistic-concurrency counter, bumped on every write. */
  version: number;
  promisedAt?: Iso;
  collectedAt?: Iso;
  cancelReason?: string;
  failureReason?: string;
  /** Status the job was in before a dispute, for the audit trail. */
  disputedFrom?: JobStatus;
  createdAt: Iso;
  updatedAt: Iso;
  demo?: boolean;
}

export type TimeWindow = '09:00-12:00' | '12:00-15:00' | '15:00-18:00' | '18:00-21:00';
export const TIME_WINDOWS: TimeWindow[] = [
  '09:00-12:00',
  '12:00-15:00',
  '15:00-18:00',
  '18:00-21:00',
];

export interface StatusHistoryEntry {
  id: Id;
  jobId: Id;
  from: JobStatus | null;
  to: JobStatus;
  actorId: Id | 'system';
  at: Iso;
  note?: string;
  fileIds?: Id[];
}

export type AssignmentState = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'REVOKED';

/** One vendor's claim on, or offer of, a job. Exactly one ACCEPTED row may exist per job. */
export interface RepairAssignment {
  id: Id;
  jobId: Id;
  vendorId: Id;
  mode: AssignmentMode;
  state: AssignmentState;
  offeredAt: Iso;
  respondedAt?: Iso;
  expiresAt?: Iso;
  assignedBy?: Id;
  note?: string;
}

// ---------- Pickup and delivery ----------

export type TaskKind = 'PICKUP' | 'DELIVERY';
export type TaskStatus =
  'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RESCHEDULED' | 'CANCELLED';

export interface PickupDeliveryTask {
  id: Id;
  jobId: Id;
  kind: TaskKind;
  status: TaskStatus;
  /** Vendor user or delivery agent user carrying out the task. */
  assigneeId: Id;
  address: Address;
  scheduledDate: string;
  window: TimeWindow;
  fee: Pkr;
  /** SHA-256(salt + code). The code itself is never stored. */
  otpHash?: string;
  otpSalt?: string;
  otpExpiresAt?: Iso;
  otpAttempts: number;
  startedAt?: Iso;
  completedAt?: Iso;
  failureReason?: string;
  notes?: string;
  evidenceIds: Id[];
  /** Reserved for live tracking; nothing writes it yet. */
  lastKnownLocation?: { lat: number; lng: number; at: Iso };
  history: { status: TaskStatus; at: Iso; actorId: Id; note?: string }[];
  createdAt: Iso;
}

export interface DeviceConditionReport {
  id: Id;
  jobId: Id;
  stage: 'PICKUP' | 'INSPECTION' | 'DELIVERY';
  physicalCondition: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  existingDamage: string;
  accessories: string[];
  /** Only stored when supplied; full value visible to the job's vendor and admins only. */
  imei?: string;
  powersOn: boolean;
  photoIds: Id[];
  recordedBy: Id;
  at: Iso;
}

export interface RepairInspection {
  id: Id;
  jobId: Id;
  findings: string;
  proposedRepair: string;
  repairable: boolean;
  recordedBy: Id;
  at: Iso;
}

// ---------- Quotations ----------

export type QuoteItemType = 'PART' | 'LABOR' | 'DIAGNOSTIC' | 'DELIVERY' | 'OTHER';
export type QuotationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export interface QuotationItem {
  type: QuoteItemType;
  description: string;
  quantity: number;
  unitPrice: Pkr;
}

export interface RepairQuotation {
  id: Id;
  jobId: Id;
  version: number;
  items: QuotationItem[];
  discount: Pkr;
  taxRatePct: number;
  estimatedCompletion: Iso;
  warrantyDays: number;
  notes?: string;
  /** Commission terms captured with the quotation, so later setting changes don't rewrite history. */
  commissionPct: number;
  commissionFixed: Pkr;
  status: QuotationStatus;
  createdBy: Id;
  createdAt: Iso;
  respondedAt?: Iso;
  responseNote?: string;
}

export interface RepairPartUsage {
  id: Id;
  jobId: Id;
  partName: string;
  partNumber?: string;
  quantity: number;
  unitCost: Pkr;
  recordedBy: Id;
  at: Iso;
}

export interface RepairWorkLog {
  id: Id;
  jobId: Id;
  note: string;
  fileIds: Id[];
  kind: 'NOTE' | 'BEFORE' | 'AFTER' | 'DELAY';
  recordedBy: Id;
  at: Iso;
}

// ---------- Money ----------

export type PaymentMethod = 'CASH_ON_DELIVERY' | 'CASH_TO_VENDOR' | 'BANK_TRANSFER' | 'ONLINE';
/** Who is physically holding the money: this drives vendor/platform balances. */
export type Collector = 'PLATFORM' | 'VENDOR';

/** Immutable ledger entry. Corrections are new entries, never edits. */
export interface PaymentTransaction {
  id: Id;
  jobId: Id;
  kind: 'PAYMENT' | 'REFUND';
  method: PaymentMethod;
  collector: Collector;
  amount: Pkr; // always positive; kind gives the direction
  reference?: string;
  /** Unique: replays of the same webhook or double-clicks are ignored. */
  idempotencyKey: string;
  status: 'CONFIRMED' | 'PENDING_VERIFICATION';
  recordedBy: Id;
  verifiedBy?: Id;
  reason?: string;
  at: Iso;
}

export interface VendorSettlement {
  id: Id;
  vendorId: Id;
  /** Positive: platform paid the vendor. Negative: vendor paid the platform. */
  amount: Pkr;
  reference: string;
  periodFrom: Iso;
  periodTo: Iso;
  createdBy: Id;
  at: Iso;
}

export interface Invoice {
  id: Id;
  jobId: Id;
  number: string;
  issuedAt: Iso;
  quotationId: Id;
}

export interface Warranty {
  id: Id;
  jobId: Id;
  days: number;
  terms: string;
  startsAt: Iso;
  endsAt: Iso;
}

// ---------- Feedback and support ----------

export interface Review {
  id: Id;
  jobId: Id;
  customerId: Id;
  vendorId: Id;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  status: 'PUBLISHED' | 'HIDDEN';
  moderationNote?: string;
  at: Iso;
}

export type ComplaintStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED';

export interface Complaint {
  id: Id;
  jobId?: Id;
  raisedBy: Id;
  subject: string;
  isDispute: boolean;
  status: ComplaintStatus;
  messages: SupportMessage[];
  resolution?: string;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface SupportMessage {
  id: Id;
  authorId: Id;
  body: string;
  at: Iso;
}

export interface Notification {
  id: Id;
  userId: Id;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  at: Iso;
}

export type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP';

/** Outbound message attempt. Without a configured provider the attempt is logged as such, never "sent". */
export interface DeliveryLogEntry {
  id: Id;
  notificationId: Id;
  channel: Channel;
  to: string;
  status: 'SENT' | 'PROVIDER_NOT_CONFIGURED' | 'FAILED';
  at: Iso;
}

export interface UploadedFile {
  id: Id;
  ownerId: Id;
  mime: string;
  size: number;
  dataUrl: string;
  /** PRIVATE: owner and admins. JOB: the job's customer, vendor, agent and admins. */
  visibility: 'PRIVATE' | 'JOB';
  jobId?: Id;
  at: Iso;
}

export interface AuditLog {
  id: Id;
  actorId: Id | 'system';
  action: string;
  entity: string;
  entityId: Id;
  detail?: string;
  at: Iso;
}

// ---------- Settings ----------

export type AssignmentMode = 'FIRST_ACCEPT' | 'ADMIN_ASSIGN';

export interface SystemSettings {
  assignmentMode: AssignmentMode;
  /** Hours a vendor has to answer an admin assignment before it expires. */
  acceptanceTimeoutHours: number;
  commissionPct: number;
  commissionFixed: Pkr;
  taxRatePct: number;
  defaultPickupFee: Pkr;
  defaultDeliveryFee: Pkr;
  diagnosticFee: Pkr;
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  /** Customers may cancel while the job is in one of these statuses. */
  customerCancellable: JobStatus[];
  enabledPaymentMethods: PaymentMethod[];
  providers: Record<Channel, { configured: boolean; label: string }>;
  onlineGateway: { configured: boolean; label: string };
  reviewPolicy: string;
}
