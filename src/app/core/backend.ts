import { z } from 'zod';
import { hashSecret, randomDigits, randomHex, safeEqual, sha256 } from './crypto';
import { Db, DbStorage } from './db';
import {
  commissionFor,
  jobFinancials,
  JobFinancials,
  quoteTotals,
  vendorBalance,
  VendorBalance,
} from './finance';
import {
  Address,
  AuditLog,
  Channel,
  Complaint,
  ComplaintStatus,
  DeviceConditionReport,
  Id,
  JobStatus,
  Notification,
  PaymentMethod,
  Permission,
  PickupDeliveryTask,
  PublicUser,
  RepairAssignment,
  RepairInspection,
  RepairJob,
  RepairPartUsage,
  RepairQuotation,
  RepairWorkLog,
  Review,
  StatusHistoryEntry,
  SystemSettings,
  TaskKind,
  TimeWindow,
  UploadedFile,
  User,
  VendorProfile,
  VendorSettlement,
  Warranty,
  Invoice,
  PaymentTransaction,
  Role,
  VendorStatus,
} from './models';
import {
  complaintSchema,
  conditionSchema,
  firstIssue,
  passwordSchema,
  paymentSchema,
  phoneSchema,
  quotationSchema,
  refundSchema,
  registerCustomerSchema,
  registerVendorSchema,
  repairRequestSchema,
  reviewSchema,
  scheduleSchema,
  settingsSchema,
  staffSchema,
  addressSchema,
} from './schemas';
import {
  Actor,
  ACTIVE_STATUSES,
  canTransition,
  COMPLETED_STATUSES,
  findTransition,
} from './workflow';

import { ApiError } from './errors';

export { ApiError };
export type { ErrorCode } from './errors';

const SESSION_DAYS = 7;
const MAX_LOGIN_FAILURES = 5;
const LOCK_MINUTES = 15;
const MAX_FILE_BYTES = 1_500_000;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// ---------- Response shapes ----------

export interface Catalog {
  brands: { id: Id; name: string }[];
  models: { id: Id; brandId: Id; name: string }[];
  categories: { id: Id; name: string; icon: string; fromPrice: number }[];
  areas: { id: Id; name: string; city: string }[];
}

export interface VendorPublic {
  id: Id;
  shopName: string;
  areaName: string;
  rating: number | null;
  reviewCount: number;
  completedJobs: number;
  since: string;
  bio?: string;
}

export interface HistoryView extends StatusHistoryEntry {
  actorName: string;
}

/** Everything one user may see about a job. LIMITED is the pre-acceptance marketplace view. */
export interface JobView {
  access: 'FULL' | 'LIMITED';
  job: RepairJob;
  brand: string;
  model: string;
  category: string;
  area: string;
  customer?: { name: string; phone: string };
  vendor?: VendorPublic;
  vendorPhone?: string;
  agent?: { name: string; phone: string };
  history: HistoryView[];
  tasks: Omit<PickupDeliveryTask, 'otpHash' | 'otpSalt'>[];
  conditions: DeviceConditionReport[];
  inspection?: RepairInspection;
  quotations: RepairQuotation[];
  parts: RepairPartUsage[];
  workLogs: RepairWorkLog[];
  transactions: PaymentTransaction[];
  financials: JobFinancials;
  warranty?: Warranty;
  invoice?: Invoice;
  review?: Review;
  assignment?: RepairAssignment;
  canReview: boolean;
}

export interface JobSummary {
  id: Id;
  ref: string;
  status: JobStatus;
  outcome: RepairJob['outcome'];
  brand: string;
  model: string;
  category: string;
  area: string;
  customerName?: string;
  vendorName?: string;
  vendorId?: Id;
  total: number;
  outstanding: number;
  createdAt: string;
  updatedAt: string;
  promisedAt?: string;
  preferredPickupDate: string;
  overdue: boolean;
  offeredToMe?: boolean;
  demo?: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JobQuery {
  search?: string;
  status?: JobStatus | 'ACTIVE' | 'OVERDUE' | '';
  vendorId?: string;
  areaId?: string;
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'updated' | 'total';
  page?: number;
  pageSize?: number;
}

export interface TaskView {
  task: Omit<PickupDeliveryTask, 'otpHash' | 'otpSalt'>;
  jobRef: string;
  jobStatus: JobStatus;
  device: string;
  customerName: string;
  customerPhone: string;
  area: string;
}

/** Admin read model used by dashboards and reports. Sensitive fields are stripped. */
export interface ReportData {
  jobs: RepairJob[];
  history: StatusHistoryEntry[];
  quotations: RepairQuotation[];
  transactions: PaymentTransaction[];
  settlements: VendorSettlement[];
  reviews: Review[];
  complaints: Complaint[];
  vendors: { id: Id; shopName: string; status: VendorStatus; createdAt: string }[];
  customers: { id: Id; createdAt: string }[];
  assignments: RepairAssignment[];
  brands: { id: Id; name: string }[];
  models: { id: Id; name: string }[];
  categories: { id: Id; name: string }[];
  areas: { id: Id; name: string }[];
  now: string;
}

export type CreateRequestInput = z.input<typeof repairRequestSchema>;
export type RegisterVendorInput = z.input<typeof registerVendorSchema>;
export type QuotationInput = z.input<typeof quotationSchema>;
export type ConditionInput = z.input<typeof conditionSchema>;
export type ScheduleInput = z.input<typeof scheduleSchema>;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError('VALIDATION', firstIssue(result.error));
  return result.data;
}

const toPublic = (u: User): PublicUser => {
  const { passwordHash: _p, salt: _s, failedLogins: _f, lockedUntil: _l, ...rest } = u;
  return rest;
};

const stripOtp = (t: PickupDeliveryTask): Omit<PickupDeliveryTask, 'otpHash' | 'otpSalt'> => {
  const { otpHash: _h, otpSalt: _s, ...rest } = t;
  return rest;
};

const maskImei = (imei?: string) => (imei ? `•••••••••••${imei.slice(-4)}` : undefined);

/**
 * The application's server. It runs in the browser for this portfolio build, but is
 * written as if it were remote: callers pass only a session token and plain input,
 * every call re-reads the database, authorises the caller, validates input, and
 * commits all of its writes or none of them.
 */
export class Backend {
  constructor(
    private readonly storage: DbStorage,
    private readonly init: () => Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // =====================================================================
  // Infrastructure
  // =====================================================================

  /** Runs `fn` against a fresh copy of the database and saves only if it returns normally. */
  private tx<T>(fn: (db: Db) => T): T {
    const db = this.storage.load() ?? this.init();
    this.sweep(db);
    const result = fn(db);
    this.storage.save(db);
    return result;
  }

  private read<T>(fn: (db: Db) => T): T {
    return this.tx(fn);
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private nextId(db: Db, prefix: string): Id {
    db.seq += 1;
    return `${prefix}_${db.seq}`;
  }

  /** Expires unanswered admin assignments and returns the job to the queue. */
  private sweep(db: Db): void {
    const now = this.now();
    for (const a of db.assignments) {
      if (a.state !== 'OFFERED' || !a.expiresAt || a.expiresAt > now) continue;
      a.state = 'EXPIRED';
      a.respondedAt = now;
      const job = db.jobs.find((j) => j.id === a.jobId);
      if (job?.status === 'AWAITING_VENDOR') {
        this.setStatus(
          db,
          job,
          'SUBMITTED',
          'system',
          'Vendor did not respond in time; returned to queue.',
        );
        this.notifyAdmins(
          db,
          'jobs.assign',
          'Assignment expired',
          `${job.ref} needs a new vendor.`,
          job.id,
        );
      }
    }
  }

  private auth(db: Db, token: string | null): User {
    const session = token ? db.sessions.find((s) => s.token === sha256(token)) : undefined;
    if (!session || session.expiresAt < this.now()) {
      throw new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
    const user = db.users.find((u) => u.id === session.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new ApiError('UNAUTHENTICATED', 'This account is not active.');
    }
    return user;
  }

  private hasPerm(user: User, perm: Permission): boolean {
    return (
      user.role === 'SUPER_ADMIN' || (user.role === 'STAFF' && user.permissions.includes(perm))
    );
  }

  private requirePerm(user: User, perm: Permission): void {
    if (!this.hasPerm(user, perm))
      throw new ApiError('FORBIDDEN', 'You do not have permission to do that.');
  }

  private requireRole(user: User, ...roles: Role[]): void {
    if (!roles.includes(user.role))
      throw new ApiError('FORBIDDEN', 'You do not have permission to do that.');
  }

  private isAdmin(user: User): boolean {
    return user.role === 'SUPER_ADMIN' || user.role === 'STAFF';
  }

  private approvedVendor(db: Db, user: User): VendorProfile {
    this.requireRole(user, 'VENDOR');
    const vendor = db.vendors.find((v) => v.userId === user.id);
    if (!vendor || vendor.status !== 'APPROVED') {
      throw new ApiError('FORBIDDEN', 'Your vendor account is not approved.');
    }
    return vendor;
  }

  private rateLimit(db: Db, key: string, max: number, windowMinutes: number): void {
    const nowMs = this.clock().getTime();
    const recent = (db.rateLimits[key] ?? []).filter((t) => nowMs - t < windowMinutes * 60_000);
    if (recent.length >= max) {
      throw new ApiError(
        'RATE_LIMITED',
        'Too many attempts. Please wait a few minutes and try again.',
      );
    }
    recent.push(nowMs);
    db.rateLimits[key] = recent;
  }

  private audit(
    db: Db,
    actor: User | 'system',
    action: string,
    entity: string,
    entityId: Id,
    detail?: string,
  ) {
    const entry: AuditLog = {
      id: this.nextId(db, 'aud'),
      actorId: actor === 'system' ? 'system' : actor.id,
      action,
      entity,
      entityId,
      detail,
      at: this.now(),
    };
    db.audit.push(entry);
  }

  private job(db: Db, id: Id): RepairJob {
    const job = db.jobs.find((j) => j.id === id);
    if (!job) throw new ApiError('NOT_FOUND', 'Repair job not found.');
    return job;
  }

  private actorKind(db: Db, user: User, job: RepairJob): Actor | null {
    if (user.role === 'CUSTOMER') return job.customerId === user.id ? 'CUSTOMER' : null;
    if (user.role === 'VENDOR') return job.vendorId === user.id ? 'VENDOR' : null;
    if (user.role === 'AGENT') {
      return db.tasks.some((t) => t.jobId === job.id && t.assigneeId === user.id) ? 'AGENT' : null;
    }
    return this.hasPerm(user, 'jobs.assign') ? 'ADMIN' : null;
  }

  /** Changes status only along an allowed transition, recording immutable history. */
  private setStatus(
    db: Db,
    job: RepairJob,
    to: JobStatus,
    actor: User | 'system',
    note?: string,
    fileIds?: Id[],
    actorKind?: Actor,
  ): void {
    const kind: Actor | null =
      actor === 'system' ? 'SYSTEM' : (actorKind ?? this.actorKind(db, actor, job));
    if (!kind || !canTransition(job.status, to, kind)) {
      const label = findTransition(job.status, to)?.label ?? to;
      throw new ApiError(
        'CONFLICT',
        `"${label}" is not allowed while the job is ${job.status.replaceAll('_', ' ').toLowerCase()}.`,
      );
    }
    const entry: StatusHistoryEntry = {
      id: this.nextId(db, 'hist'),
      jobId: job.id,
      from: job.status,
      to,
      actorId: actor === 'system' ? 'system' : actor.id,
      at: this.now(),
      note: note?.trim() || undefined,
      fileIds: fileIds?.length ? fileIds : undefined,
    };
    db.history.push(entry);
    job.status = to;
    job.version += 1;
    job.updatedAt = entry.at;
  }

  private checkVersion(job: RepairJob, expected?: number): void {
    if (expected !== undefined && job.version !== expected) {
      throw new ApiError(
        'CONFLICT',
        'This job was updated by someone else. Refresh to see the latest.',
      );
    }
  }

  private linkFor(user: User, jobId: Id): string {
    const base = {
      CUSTOMER: 'customer',
      VENDOR: 'vendor',
      AGENT: 'agent',
      STAFF: 'admin',
      SUPER_ADMIN: 'admin',
    }[user.role];
    return `/${base}/jobs/${jobId}`;
  }

  /**
   * In-app notification plus an outbound attempt per channel. Channels without a
   * configured provider are logged as such; nothing pretends a message went out.
   */
  private notify(db: Db, userId: Id, title: string, body: string, jobId?: Id): void {
    const user = db.users.find((u) => u.id === userId);
    if (!user || user.status === 'DELETED') return;
    const n: Notification = {
      id: this.nextId(db, 'ntf'),
      userId,
      title,
      body,
      link: jobId ? this.linkFor(user, jobId) : undefined,
      read: false,
      at: this.now(),
    };
    db.notifications.push(n);
    const channels: [Channel, string][] = [
      ['EMAIL', user.email],
      ['SMS', user.phone],
    ];
    for (const [channel, to] of channels) {
      db.deliveryLog.push({
        id: this.nextId(db, 'dlv'),
        notificationId: n.id,
        channel,
        to,
        status: db.settings.providers[channel].configured ? 'SENT' : 'PROVIDER_NOT_CONFIGURED',
        at: n.at,
      });
    }
  }

  private notifyAdmins(db: Db, perm: Permission, title: string, body: string, jobId?: Id): void {
    for (const u of db.users) {
      if (u.status === 'ACTIVE' && this.hasPerm(u, perm)) this.notify(db, u.id, title, body, jobId);
    }
  }

  /** Notifies the customer, the vendor and any agent on the job, except the actor. */
  private notifyParties(
    db: Db,
    job: RepairJob,
    actor: User | 'system',
    title: string,
    body: string,
  ): void {
    const ids = new Set<Id>([job.customerId]);
    if (job.vendorId) ids.add(job.vendorId);
    for (const t of db.tasks)
      if (t.jobId === job.id && t.status !== 'CANCELLED') ids.add(t.assigneeId);
    if (actor !== 'system') ids.delete(actor.id);
    for (const id of ids) this.notify(db, id, title, body, job.id);
  }

  private name(db: Db, id: Id | 'system'): string {
    if (id === 'system') return 'System';
    const u = db.users.find((x) => x.id === id);
    if (!u) return 'Unknown';
    if (u.role === 'VENDOR') return db.vendors.find((v) => v.userId === id)?.shopName ?? u.name;
    if (u.role === 'SUPER_ADMIN' || u.role === 'STAFF') return 'Repair Hub support';
    return u.name;
  }

  private eligible(db: Db, vendor: VendorProfile, job: RepairJob): boolean {
    const user = db.users.find((u) => u.id === vendor.userId);
    return (
      !!user &&
      user.status === 'ACTIVE' &&
      vendor.status === 'APPROVED' &&
      vendor.available &&
      vendor.specialties.includes(job.categoryId) &&
      vendor.brands.includes(job.brandId) &&
      vendor.serviceAreas.includes(job.pickupAddress.area)
    );
  }

  private eligibleVendors(db: Db, job: RepairJob): VendorProfile[] {
    return db.vendors.filter((v) => this.eligible(db, v, job));
  }

  /** Publishes a job to every eligible vendor (first-accept mode). */
  private publish(db: Db, job: RepairJob, actor: User | 'system'): void {
    this.setStatus(
      db,
      job,
      'AWAITING_VENDOR',
      actor,
      'Published to eligible vendors.',
      undefined,
      actor === 'system' ? undefined : 'ADMIN',
    );
    const vendors = this.eligibleVendors(db, job);
    for (const v of vendors) {
      this.notify(
        db,
        v.userId,
        'New job available',
        `${this.deviceName(db, job)}: ${this.lookup(db, 'categories', job.categoryId)}.`,
        job.id,
      );
    }
    if (vendors.length === 0) {
      this.notifyAdmins(
        db,
        'jobs.assign',
        'No eligible vendor',
        `${job.ref} matches no available vendor yet.`,
        job.id,
      );
    }
  }

  private lookup(db: Db, table: 'brands' | 'models' | 'categories' | 'areas', id: Id): string {
    return (db[table] as { id: Id; name: string }[]).find((x) => x.id === id)?.name ?? '—';
  }

  private deviceName(db: Db, job: RepairJob): string {
    return `${this.lookup(db, 'brands', job.brandId)} ${this.lookup(db, 'models', job.modelId)}`;
  }

  private ownsFile(db: Db, user: User, fileIds: Id[], jobId?: Id): void {
    for (const id of fileIds) {
      const f = db.files.find((x) => x.id === id);
      if (!f || f.ownerId !== user.id)
        throw new ApiError('VALIDATION', 'One of the attached files is invalid.');
      if (jobId) {
        f.jobId = jobId;
        f.visibility = 'JOB';
      }
    }
  }

  private newOtp(db: Db, task: PickupDeliveryTask): string {
    const code = randomDigits(6);
    task.otpSalt = randomHex(8);
    task.otpHash = hashSecret(code, task.otpSalt, 50);
    task.otpExpiresAt = new Date(
      this.clock().getTime() + db.settings.otpTtlMinutes * 60_000,
    ).toISOString();
    task.otpAttempts = 0;
    return code;
  }

  private verifyOtp(db: Db, task: PickupDeliveryTask, code: string): void {
    if (!task.otpHash || !task.otpSalt || !task.otpExpiresAt) {
      throw new ApiError('VALIDATION', 'The customer has not generated a handover code yet.');
    }
    if (task.otpAttempts >= db.settings.otpMaxAttempts) {
      throw new ApiError(
        'RATE_LIMITED',
        'Too many wrong codes. Ask the customer to generate a new one.',
      );
    }
    if (task.otpExpiresAt < this.now()) {
      throw new ApiError(
        'VALIDATION',
        'The handover code has expired. Ask the customer for a new one.',
      );
    }
    if (!safeEqual(hashSecret(code.trim(), task.otpSalt, 50), task.otpHash)) {
      task.otpAttempts += 1;
      // Persist the failed attempt even though the request fails.
      this.storage.save(db);
      throw new ApiError('VALIDATION', 'That handover code is not correct.');
    }
    task.otpHash = undefined;
    task.otpSalt = undefined;
    task.otpExpiresAt = undefined;
  }

  private activeTask(db: Db, jobId: Id, kind: TaskKind): PickupDeliveryTask | undefined {
    return db.tasks.find(
      (t) =>
        t.jobId === jobId &&
        t.kind === kind &&
        (t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS'),
    );
  }

  private taskStatus(
    task: PickupDeliveryTask,
    status: PickupDeliveryTask['status'],
    actor: User,
    note?: string,
  ) {
    task.status = status;
    task.history.push({ status, at: this.now(), actorId: actor.id, note });
    if (status === 'IN_PROGRESS') task.startedAt = this.now();
    if (status === 'COMPLETED') task.completedAt = this.now();
  }

  private assignee(db: Db, job: RepairJob, requested?: Id): Id {
    if (!requested || requested === job.vendorId) return job.vendorId!;
    const agent = db.users.find(
      (u) => u.id === requested && u.role === 'AGENT' && u.status === 'ACTIVE',
    );
    if (!agent) throw new ApiError('VALIDATION', 'Choose an active delivery agent.');
    return agent.id;
  }

  private createTask(
    db: Db,
    job: RepairJob,
    kind: TaskKind,
    input: z.output<typeof scheduleSchema>,
    actor: User,
  ) {
    const assigneeId = this.assignee(db, job, input.assigneeId);
    const task: PickupDeliveryTask = {
      id: this.nextId(db, 'task'),
      jobId: job.id,
      kind,
      status: 'SCHEDULED',
      assigneeId,
      address: kind === 'PICKUP' ? job.pickupAddress : job.deliveryAddress,
      scheduledDate: input.date,
      window: input.window as TimeWindow,
      fee: input.fee,
      otpAttempts: 0,
      notes: input.note,
      evidenceIds: [],
      history: [{ status: 'SCHEDULED', at: this.now(), actorId: actor.id, note: input.note }],
      createdAt: this.now(),
    };
    db.tasks.push(task);
    job.agentId = assigneeId !== job.vendorId ? assigneeId : undefined;
    return task;
  }

  /** After delivery or payment, move the job to its final state if the money allows it. */
  private settleIfPossible(db: Db, job: RepairJob): void {
    const f = jobFinancials(job, db.quotations, db.transactions);
    if (job.status === 'DELIVERED' && job.outcome === 'NOT_REPAIRED') {
      this.setStatus(
        db,
        job,
        'RETURNED_WITHOUT_REPAIR',
        'system',
        'Phone returned to the customer without repair.',
      );
    }
    if (job.status !== 'DELIVERED' && job.status !== 'RETURNED_WITHOUT_REPAIR') return;
    if (f.total === 0) {
      this.setStatus(db, job, 'CLOSED', 'system', 'Nothing to pay; job closed.');
    } else if (f.outstanding === 0) {
      this.setStatus(db, job, 'PAID', 'system', 'Paid in full.');
    }
  }

  // =====================================================================
  // Authentication
  // =====================================================================

  login(emailInput: string, password: string): { token: string; user: PublicUser } {
    return this.tx((db) => {
      const email = emailInput.trim().toLowerCase();
      this.rateLimit(db, `login:${email}`, 10, 15);
      const user = db.users.find((u) => u.email === email && u.status !== 'DELETED');
      const generic = new ApiError('UNAUTHENTICATED', 'Email or password is incorrect.');
      if (!user) throw generic;
      if (user.lockedUntil && user.lockedUntil > this.now()) {
        throw new ApiError('RATE_LIMITED', 'Too many failed sign-ins. Try again in 15 minutes.');
      }
      if (!safeEqual(hashSecret(password, user.salt), user.passwordHash)) {
        user.failedLogins += 1;
        if (user.failedLogins >= MAX_LOGIN_FAILURES) {
          user.lockedUntil = new Date(this.clock().getTime() + LOCK_MINUTES * 60_000).toISOString();
          user.failedLogins = 0;
          this.audit(db, 'system', 'auth.locked', 'user', user.id);
        }
        this.storage.save(db);
        throw generic;
      }
      if (user.status === 'SUSPENDED')
        throw new ApiError('FORBIDDEN', 'This account is suspended. Contact support.');
      user.failedLogins = 0;
      user.lockedUntil = undefined;
      user.lastLoginAt = this.now();
      const token = this.issueSession(db, user.id);
      return { token, user: toPublic(user) };
    });
  }

  private issueSession(db: Db, userId: Id): string {
    const token = randomHex(24);
    const now = this.clock();
    db.sessions = db.sessions.filter((s) => s.expiresAt > now.toISOString());
    db.sessions.push({
      // Only the hash is stored, like a server would store session ids.
      token: sha256(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
    });
    return token;
  }

  logout(token: string): void {
    this.tx((db) => {
      db.sessions = db.sessions.filter((s) => s.token !== sha256(token));
    });
  }

  me(token: string): { user: PublicUser; vendor?: VendorProfile; addresses?: Address[] } {
    return this.read((db) => {
      const user = this.auth(db, token);
      return {
        user: toPublic(user),
        vendor: db.vendors.find((v) => v.userId === user.id),
        addresses: db.customers.find((c) => c.userId === user.id)?.addresses,
      };
    });
  }

  private createUser(
    db: Db,
    role: Role,
    data: { name: string; email: string; phone: string; password: string },
  ): User {
    if (db.users.some((u) => u.email === data.email && u.status !== 'DELETED')) {
      throw new ApiError('CONFLICT', 'An account with this email already exists.');
    }
    if (db.users.some((u) => u.phone === data.phone && u.status !== 'DELETED')) {
      throw new ApiError('CONFLICT', 'An account with this mobile number already exists.');
    }
    const salt = randomHex(16);
    const user: User = {
      id: this.nextId(db, 'usr'),
      role,
      name: data.name,
      email: data.email,
      phone: data.phone,
      phoneVerified: false,
      passwordHash: hashSecret(data.password, salt),
      salt,
      status: 'ACTIVE',
      permissions: [],
      createdAt: this.now(),
      failedLogins: 0,
    };
    db.users.push(user);
    return user;
  }

  registerCustomer(input: unknown): { token: string; user: PublicUser } {
    const data = parse(registerCustomerSchema, input);
    return this.tx((db) => {
      this.rateLimit(db, 'register', 20, 60);
      const user = this.createUser(db, 'CUSTOMER', data);
      db.customers.push({ userId: user.id, addresses: [] });
      this.audit(db, user, 'customer.registered', 'user', user.id);
      return { token: this.issueSession(db, user.id), user: toPublic(user) };
    });
  }

  registerVendor(input: unknown): { token: string; user: PublicUser } {
    const data = parse(registerVendorSchema, input);
    return this.tx((db) => {
      this.rateLimit(db, 'register', 20, 60);
      const user = this.createUser(db, 'VENDOR', { ...data, name: data.ownerName });
      this.ownsFileOrClaim(db, user, data.documentFileIds);
      db.vendors.push({
        userId: user.id,
        shopName: data.shopName,
        ownerName: data.ownerName,
        address: data.address,
        serviceAreas: data.serviceAreas,
        specialties: data.specialties,
        brands: data.brands,
        documents: data.documentFileIds.map((fileId) => ({
          kind: 'CNIC',
          fileId,
          uploadedAt: this.now(),
        })),
        payout: data.payout,
        termsAcceptedAt: this.now(),
        status: 'PENDING',
        available: true,
        hours: { days: [1, 2, 3, 4, 5, 6], open: '10:00', close: '20:00' },
      });
      this.audit(db, user, 'vendor.registered', 'vendor', user.id, data.shopName);
      this.notifyAdmins(
        db,
        'vendors.manage',
        'Vendor awaiting approval',
        `${data.shopName} has registered.`,
      );
      return { token: this.issueSession(db, user.id), user: toPublic(user) };
    });
  }

  /** Files uploaded before an account exists are owned by "anonymous" and claimed on sign-up. */
  private ownsFileOrClaim(db: Db, user: User, ids: Id[]): void {
    for (const id of ids) {
      const f = db.files.find((x) => x.id === id);
      if (!f || (f.ownerId !== user.id && f.ownerId !== 'anonymous')) {
        throw new ApiError('VALIDATION', 'One of the attached files is invalid.');
      }
      f.ownerId = user.id;
      f.visibility = 'PRIVATE';
    }
  }

  /**
   * Sends a phone verification code. With no SMS provider configured the code is
   * returned to the signed-in account owner for this demo, and the attempt is logged
   * as PROVIDER_NOT_CONFIGURED. Production must configure SMS and drop `demoCode`.
   */
  requestPhoneCode(token: string): { sentVia: 'SMS' | 'IN_APP_DEMO'; demoCode?: string } {
    return this.tx((db) => {
      const user = this.auth(db, token);
      this.rateLimit(db, `phone-code:${user.id}`, 3, 10);
      const code = randomDigits(6);
      const salt = randomHex(8);
      db.phoneCodes = db.phoneCodes.filter((c) => c.userId !== user.id);
      db.phoneCodes.push({
        userId: user.id,
        salt,
        hash: hashSecret(code, salt, 50),
        expiresAt: new Date(this.clock().getTime() + 10 * 60_000).toISOString(),
        attempts: 0,
      });
      const configured = db.settings.providers.SMS.configured;
      db.deliveryLog.push({
        id: this.nextId(db, 'dlv'),
        notificationId: 'phone-verification',
        channel: 'SMS',
        to: user.phone,
        status: configured ? 'SENT' : 'PROVIDER_NOT_CONFIGURED',
        at: this.now(),
      });
      return configured ? { sentVia: 'SMS' } : { sentVia: 'IN_APP_DEMO', demoCode: code };
    });
  }

  verifyPhone(token: string, code: string): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      const entry = db.phoneCodes.find((c) => c.userId === user.id);
      if (!entry || entry.expiresAt < this.now())
        throw new ApiError('VALIDATION', 'Request a new code.');
      if (entry.attempts >= 5)
        throw new ApiError('RATE_LIMITED', 'Too many attempts. Request a new code.');
      if (!safeEqual(hashSecret(code.trim(), entry.salt, 50), entry.hash)) {
        entry.attempts += 1;
        this.storage.save(db);
        throw new ApiError('VALIDATION', 'That code is not correct.');
      }
      user.phoneVerified = true;
      db.phoneCodes = db.phoneCodes.filter((c) => c !== entry);
      this.audit(db, user, 'user.phone-verified', 'user', user.id);
    });
  }

  updateProfile(
    token: string,
    input: { name: string; phone: string; addresses?: Address[] },
  ): PublicUser {
    const name = parse(z.string().trim().min(2).max(80), input.name);
    const phone = parse(phoneSchema, input.phone);
    const addresses = input.addresses
      ? parse(z.array(addressSchema).max(5), input.addresses)
      : undefined;
    return this.tx((db) => {
      const user = this.auth(db, token);
      if (phone !== user.phone) {
        if (db.users.some((u) => u.phone === phone && u.id !== user.id && u.status !== 'DELETED')) {
          throw new ApiError('CONFLICT', 'That mobile number is used by another account.');
        }
        user.phone = phone;
        user.phoneVerified = false;
      }
      user.name = name;
      if (addresses && user.role === 'CUSTOMER') {
        const profile = db.customers.find((c) => c.userId === user.id)!;
        profile.addresses = addresses;
      }
      this.audit(db, user, 'user.profile-updated', 'user', user.id);
      return toPublic(user);
    });
  }

  changePassword(token: string, current: string, next: string): void {
    const pw = parse(passwordSchema, next);
    this.tx((db) => {
      const user = this.auth(db, token);
      this.rateLimit(db, `password:${user.id}`, 5, 15);
      if (!safeEqual(hashSecret(current, user.salt), user.passwordHash)) {
        throw new ApiError('VALIDATION', 'Your current password is not correct.');
      }
      user.salt = randomHex(16);
      user.passwordHash = hashSecret(pw, user.salt);
      // Sign out every other session.
      const keep = sha256(token);
      db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.token === keep);
      this.audit(db, user, 'user.password-changed', 'user', user.id);
    });
  }

  /** Customers can delete their account once nothing is in progress. Records are anonymised, not erased. */
  deleteAccount(token: string): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requireRole(user, 'CUSTOMER');
      if (
        db.jobs.some(
          (j) =>
            j.customerId === user.id &&
            ACTIVE_STATUSES.includes(j.status) &&
            !['DELIVERED'].includes(j.status),
        )
      ) {
        throw new ApiError(
          'CONFLICT',
          'You have repairs in progress. Delete your account once they are finished.',
        );
      }
      user.status = 'DELETED';
      user.name = 'Deleted customer';
      user.email = `deleted-${user.id}@invalid`;
      user.phone = '';
      const profile = db.customers.find((c) => c.userId === user.id);
      if (profile) profile.addresses = [];
      db.sessions = db.sessions.filter((s) => s.userId !== user.id);
      this.audit(db, user, 'user.deleted', 'user', user.id);
    });
  }

  // =====================================================================
  // Catalogue and files
  // =====================================================================

  catalog(): Catalog {
    return this.read((db) => ({
      brands: db.brands.filter((b) => b.active).map(({ id, name }) => ({ id, name })),
      models: db.models
        .filter((m) => db.brands.find((b) => b.id === m.brandId)?.active)
        .map(({ id, brandId, name }) => ({ id, brandId, name })),
      categories: db.categories
        .filter((c) => c.active)
        .map(({ id, name, icon, fromPrice }) => ({ id, name, icon, fromPrice })),
      areas: db.areas.filter((a) => a.active).map(({ id, name, city }) => ({ id, name, city })),
    }));
  }

  /** Validates type and size. Anonymous uploads are allowed only for vendor sign-up documents. */
  uploadFile(
    token: string | null,
    file: { dataUrl: string; mime: string; size: number },
  ): { id: Id } {
    return this.tx((db) => {
      const owner = token ? this.auth(db, token).id : 'anonymous';
      this.rateLimit(db, `upload:${owner}`, 40, 10);
      if (!ALLOWED_MIME.includes(file.mime))
        throw new ApiError('VALIDATION', 'Upload a JPEG, PNG, WebP or PDF file.');
      if (file.size > MAX_FILE_BYTES)
        throw new ApiError('VALIDATION', 'Files must be 1.5 MB or smaller.');
      if (!file.dataUrl.startsWith(`data:${file.mime};base64,`)) {
        throw new ApiError('VALIDATION', 'The file content does not match its type.');
      }
      const f: UploadedFile = {
        id: this.nextId(db, 'file'),
        ownerId: owner,
        mime: file.mime,
        size: file.size,
        dataUrl: file.dataUrl,
        visibility: 'PRIVATE',
        at: this.now(),
      };
      db.files.push(f);
      return { id: f.id };
    });
  }

  file(token: string, id: Id): { mime: string; dataUrl: string } {
    return this.read((db) => {
      const user = this.auth(db, token);
      const f = db.files.find((x) => x.id === id);
      if (!f) throw new ApiError('NOT_FOUND', 'File not found.');
      const allowed =
        f.ownerId === user.id ||
        this.hasPerm(user, 'jobs.view') ||
        (f.visibility === 'JOB' &&
          f.jobId &&
          this.jobAccess(db, user, this.job(db, f.jobId)) === 'FULL') ||
        (this.hasPerm(user, 'vendors.manage') &&
          db.vendors.some((v) => v.documents.some((d) => d.fileId === id)));
      if (!allowed) throw new ApiError('FORBIDDEN', 'You cannot open this file.');
      return { mime: f.mime, dataUrl: f.dataUrl };
    });
  }

  // =====================================================================
  // Jobs: shared reads
  // =====================================================================

  /**
   * Record-level access. FULL: the job's customer, its accepted vendor, an agent with a
   * task on it, or staff with jobs.view. LIMITED: an eligible vendor browsing the marketplace.
   */
  private jobAccess(db: Db, user: User, job: RepairJob): 'FULL' | 'LIMITED' | null {
    if (this.hasPerm(user, 'jobs.view')) return 'FULL';
    if (user.role === 'CUSTOMER') return job.customerId === user.id ? 'FULL' : null;
    if (user.role === 'AGENT')
      return db.tasks.some((t) => t.jobId === job.id && t.assigneeId === user.id) ? 'FULL' : null;
    if (user.role === 'VENDOR') {
      if (job.vendorId === user.id) return 'FULL';
      if (job.status !== 'AWAITING_VENDOR') return null;
      const offer = db.assignments.find((a) => a.jobId === job.id && a.state === 'OFFERED');
      if (offer) return offer.vendorId === user.id ? 'LIMITED' : null;
      const vendor = db.vendors.find((v) => v.userId === user.id);
      return vendor &&
        db.settings.assignmentMode === 'FIRST_ACCEPT' &&
        this.eligible(db, vendor, job)
        ? 'LIMITED'
        : null;
    }
    return null;
  }

  private vendorPublic(db: Db, vendorId: Id): VendorPublic | undefined {
    const v = db.vendors.find((x) => x.userId === vendorId);
    if (!v) return undefined;
    const reviews = db.reviews.filter((r) => r.vendorId === vendorId && r.status === 'PUBLISHED');
    return {
      id: vendorId,
      shopName: v.shopName,
      areaName: this.lookup(db, 'areas', v.address.area),
      rating: reviews.length
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
        : null,
      reviewCount: reviews.length,
      completedJobs: db.jobs.filter(
        (j) => j.vendorId === vendorId && COMPLETED_STATUSES.includes(j.status),
      ).length,
      since: v.approvedAt ?? v.termsAcceptedAt,
      bio: v.bio,
    };
  }

  private summary(db: Db, job: RepairJob, user: User, offeredToMe = false): JobSummary {
    const f = jobFinancials(job, db.quotations, db.transactions);
    const customer = db.users.find((u) => u.id === job.customerId);
    const showCustomer = user.role !== 'VENDOR' || job.vendorId === user.id;
    return {
      id: job.id,
      ref: job.ref,
      status: job.status,
      outcome: job.outcome,
      brand: this.lookup(db, 'brands', job.brandId),
      model: this.lookup(db, 'models', job.modelId),
      category: this.lookup(db, 'categories', job.categoryId),
      area: this.lookup(db, 'areas', job.pickupAddress.area),
      customerName: showCustomer ? customer?.name : undefined,
      vendorName: job.vendorId
        ? db.vendors.find((v) => v.userId === job.vendorId)?.shopName
        : undefined,
      vendorId: job.vendorId,
      total: f.total,
      outstanding: f.outstanding,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      promisedAt: job.promisedAt,
      preferredPickupDate: job.preferredPickupDate,
      overdue: this.isOverdue(job),
      offeredToMe,
      demo: job.demo,
    };
  }

  private isOverdue(job: RepairJob): boolean {
    return (
      !!job.promisedAt &&
      job.promisedAt < this.now() &&
      ACTIVE_STATUSES.includes(job.status) &&
      !['DELIVERED', 'DISPUTED', 'CANCELLED'].includes(job.status)
    );
  }

  getJob(token: string, jobId: Id): JobView {
    return this.read((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const access = this.jobAccess(db, user, job);
      if (!access) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      const base = {
        brand: this.lookup(db, 'brands', job.brandId),
        model: this.lookup(db, 'models', job.modelId),
        category: this.lookup(db, 'categories', job.categoryId),
        area: this.lookup(db, 'areas', job.pickupAddress.area),
      };
      const assignment = db.assignments.find(
        (a) => a.jobId === job.id && (a.state === 'OFFERED' || a.state === 'ACCEPTED'),
      );
      if (access === 'LIMITED') {
        // Marketplace view: no customer identity, no street address, no photos of the customer.
        const redacted: RepairJob = {
          ...job,
          customerId: 'hidden',
          pickupAddress: {
            line1: 'Shared after acceptance',
            area: job.pickupAddress.area,
            city: job.pickupAddress.city,
          },
          deliveryAddress: {
            line1: 'Shared after acceptance',
            area: job.deliveryAddress.area,
            city: job.deliveryAddress.city,
          },
          photoIds: [],
        };
        return {
          access,
          job: redacted,
          ...base,
          history: [],
          tasks: [],
          conditions: [],
          quotations: [],
          parts: [],
          workLogs: [],
          transactions: [],
          financials: jobFinancials(job, [], []),
          assignment,
          canReview: false,
        };
      }
      const seesImei = this.isAdmin(user) || job.vendorId === user.id;
      const customer = db.users.find((u) => u.id === job.customerId);
      const vendorUser = job.vendorId ? db.users.find((u) => u.id === job.vendorId) : undefined;
      const agentUser = job.agentId ? db.users.find((u) => u.id === job.agentId) : undefined;
      const review = db.reviews.find((r) => r.jobId === job.id);
      return {
        access,
        job,
        ...base,
        customer: customer ? { name: customer.name, phone: customer.phone } : undefined,
        vendor: job.vendorId ? this.vendorPublic(db, job.vendorId) : undefined,
        vendorPhone: user.role === 'CUSTOMER' ? undefined : vendorUser?.phone,
        agent: agentUser ? { name: agentUser.name, phone: agentUser.phone } : undefined,
        history: db.history
          .filter((h) => h.jobId === job.id)
          .map((h) => ({ ...h, actorName: this.name(db, h.actorId) })),
        tasks: db.tasks.filter((t) => t.jobId === job.id).map(stripOtp),
        conditions: db.conditions
          .filter((c) => c.jobId === job.id)
          .map((c) => (seesImei ? c : { ...c, imei: maskImei(c.imei) })),
        inspection: db.inspections.filter((i) => i.jobId === job.id).at(-1),
        quotations: db.quotations
          .filter((q) => q.jobId === job.id)
          .sort((a, b) => b.version - a.version),
        parts: db.parts.filter((p) => p.jobId === job.id),
        workLogs: db.workLogs.filter((w) => w.jobId === job.id),
        transactions: db.transactions.filter((t) => t.jobId === job.id),
        financials: jobFinancials(job, db.quotations, db.transactions),
        warranty: db.warranties.find((w) => w.jobId === job.id),
        invoice: db.invoices.find((i) => i.jobId === job.id),
        review:
          review &&
          (review.status === 'PUBLISHED' || this.isAdmin(user) || review.customerId === user.id)
            ? review
            : undefined,
        assignment,
        canReview: user.role === 'CUSTOMER' && !review && this.reviewable(job),
      };
    });
  }

  private reviewable(job: RepairJob): boolean {
    return (
      !!job.vendorId &&
      ['DELIVERED', 'PAID', 'CLOSED', 'RETURNED_WITHOUT_REPAIR', 'REFUNDED'].includes(job.status)
    );
  }

  /** Jobs the caller is a party to (customer, vendor, agent) or all jobs for staff. */
  listJobs(token: string, query: JobQuery = {}): Page<JobSummary> {
    return this.read((db) => {
      const user = this.auth(db, token);
      let jobs: RepairJob[];
      if (this.isAdmin(user)) {
        this.requirePerm(user, 'jobs.view');
        jobs = db.jobs;
      } else if (user.role === 'CUSTOMER') jobs = db.jobs.filter((j) => j.customerId === user.id);
      else if (user.role === 'VENDOR') jobs = db.jobs.filter((j) => j.vendorId === user.id);
      else
        jobs = db.jobs.filter((j) =>
          db.tasks.some((t) => t.jobId === j.id && t.assigneeId === user.id),
        );
      return this.paginate(db, user, jobs, query);
    });
  }

  private paginate(db: Db, user: User, jobs: RepairJob[], q: JobQuery): Page<JobSummary> {
    let rows = jobs.map((j) => this.summary(db, j, user));
    if (q.status === 'ACTIVE') rows = rows.filter((r) => ACTIVE_STATUSES.includes(r.status));
    else if (q.status === 'OVERDUE') rows = rows.filter((r) => r.overdue);
    else if (q.status) rows = rows.filter((r) => r.status === q.status);
    if (q.vendorId) rows = rows.filter((r) => r.vendorId === q.vendorId);
    if (q.areaId) {
      const ids = new Set(jobs.filter((j) => j.pickupAddress.area === q.areaId).map((j) => j.id));
      rows = rows.filter((r) => ids.has(r.id));
    }
    if (q.from) rows = rows.filter((r) => r.createdAt >= q.from!);
    if (q.to) rows = rows.filter((r) => r.createdAt < q.to!);
    if (q.search?.trim()) {
      const s = q.search.trim().toLowerCase();
      rows = rows.filter((r) =>
        [r.ref, r.brand, r.model, r.category, r.customerName, r.vendorName, r.area].some((v) =>
          v?.toLowerCase().includes(s),
        ),
      );
    }
    const sorters: Record<string, (a: JobSummary, b: JobSummary) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      total: (a, b) => b.total - a.total,
    };
    rows.sort(sorters[q.sort ?? 'newest']);
    const pageSize = Math.min(10_000, Math.max(5, q.pageSize ?? 10));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(pages, Math.max(1, q.page ?? 1));
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }

  // =====================================================================
  // Customer
  // =====================================================================

  createRequest(token: string, input: CreateRequestInput): JobSummary {
    const data = parse(repairRequestSchema, input);
    return this.tx((db) => {
      const user = this.auth(db, token);
      this.requireRole(user, 'CUSTOMER');
      this.rateLimit(db, `request:${user.id}`, 10, 60);
      const model = db.models.find((m) => m.id === data.modelId);
      if (
        !db.brands.some((b) => b.id === data.brandId && b.active) ||
        model?.brandId !== data.brandId
      ) {
        throw new ApiError('VALIDATION', 'Choose a valid brand and model.');
      }
      if (!db.categories.some((c) => c.id === data.categoryId && c.active)) {
        throw new ApiError('VALIDATION', 'Choose a valid problem category.');
      }
      for (const a of [data.pickupAddress, data.deliveryAddress]) {
        if (!db.areas.some((x) => x.id === a.area && x.active)) {
          throw new ApiError('VALIDATION', 'We do not serve that area yet.');
        }
      }
      if (data.preferredPickupDate < this.now().slice(0, 10)) {
        throw new ApiError('VALIDATION', 'The pickup date cannot be in the past.');
      }
      const id = this.nextId(db, 'job');
      this.ownsFile(db, user, data.photoIds, id);
      const job: RepairJob = {
        id,
        ref: `MRH-${db.seq}`,
        customerId: user.id,
        brandId: data.brandId,
        modelId: data.modelId,
        categoryId: data.categoryId,
        description: data.description,
        photoIds: data.photoIds,
        pickupAddress: data.pickupAddress,
        deliveryAddress: data.deliveryAddress,
        preferredPickupDate: data.preferredPickupDate,
        preferredPickupWindow: data.preferredPickupWindow as TimeWindow,
        diagnosticConsent: data.diagnosticConsent,
        diagnosticFee: data.diagnosticConsent ? db.settings.diagnosticFee : 0,
        status: 'SUBMITTED',
        outcome: 'PENDING',
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      db.jobs.push(job);
      db.history.push({
        id: this.nextId(db, 'hist'),
        jobId: id,
        from: null,
        to: 'SUBMITTED',
        actorId: user.id,
        at: job.createdAt,
      });
      const profile = db.customers.find((c) => c.userId === user.id);
      if (profile && !profile.addresses.some((a) => a.line1 === data.pickupAddress.line1)) {
        profile.addresses = [data.pickupAddress, ...profile.addresses].slice(0, 5);
      }
      this.notify(
        db,
        user.id,
        'Request received',
        `We received ${job.ref} and are finding a repair shop.`,
        id,
      );
      if (db.settings.assignmentMode === 'FIRST_ACCEPT') this.publish(db, job, 'system');
      else
        this.notifyAdmins(
          db,
          'jobs.assign',
          'New request to assign',
          `${job.ref}: ${this.deviceName(db, job)}.`,
          id,
        );
      this.audit(db, user, 'job.created', 'job', id);
      return this.summary(db, job, user);
    });
  }

  cancelJob(token: string, jobId: Id, reason: string): void {
    const note = parse(
      z.string().trim().min(3, 'Tell us why you are cancelling.').max(300),
      reason,
    );
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const kind = this.actorKind(db, user, job);
      if (kind === 'CUSTOMER') {
        if (!db.settings.customerCancellable.includes(job.status)) {
          throw new ApiError(
            'CONFLICT',
            'This request can no longer be cancelled online. Contact support.',
          );
        }
      } else if (!this.hasPerm(user, 'jobs.cancel')) {
        throw new ApiError('FORBIDDEN', 'You do not have permission to cancel jobs.');
      }
      this.setStatus(
        db,
        job,
        'CANCELLED',
        user,
        note,
        undefined,
        kind === 'CUSTOMER' ? 'CUSTOMER' : 'ADMIN',
      );
      job.cancelReason = note;
      for (const t of db.tasks)
        if (t.jobId === job.id && (t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS'))
          this.taskStatus(t, 'CANCELLED', user, note);
      for (const a of db.assignments)
        if (a.jobId === job.id && a.state === 'OFFERED') a.state = 'REVOKED';
      this.notifyParties(db, job, user, 'Request cancelled', `${job.ref} was cancelled: ${note}`);
      this.audit(db, user, 'job.cancelled', 'job', job.id, note);
    });
  }

  respondToQuotation(token: string, jobId: Id, quotationId: Id, approve: boolean, note = ''): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      if (job.customerId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      const quote = db.quotations.find((q) => q.id === quotationId && q.jobId === job.id);
      if (!quote || quote.status !== 'PENDING' || job.status !== 'AWAITING_APPROVAL') {
        throw new ApiError('CONFLICT', 'This quotation is no longer awaiting your answer.');
      }
      if (!approve && note.trim().length < 3)
        throw new ApiError('VALIDATION', 'Tell the shop why you are rejecting it.');
      quote.respondedAt = this.now();
      quote.responseNote = note.trim() || undefined;
      const totals = quoteTotals(quote.items, quote.discount, quote.taxRatePct);
      if (approve) {
        for (const q of db.quotations)
          if (q.jobId === job.id && q.status === 'APPROVED') q.status = 'SUPERSEDED';
        quote.status = 'APPROVED';
        job.promisedAt = quote.estimatedCompletion;
        this.setStatus(
          db,
          job,
          'QUOTATION_APPROVED',
          user,
          `Approved v${quote.version} for Rs ${totals.total}.`,
        );
        this.notifyParties(
          db,
          job,
          user,
          'Quotation approved',
          `${job.ref}: the customer approved Rs ${totals.total}.`,
        );
      } else {
        // Rejection stops the repair, including any earlier approved version.
        for (const q of db.quotations)
          if (q.jobId === job.id && q.status === 'APPROVED') q.status = 'SUPERSEDED';
        quote.status = 'REJECTED';
        job.outcome = 'NOT_REPAIRED';
        this.setStatus(db, job, 'QUOTATION_REJECTED', user, note);
        this.notifyParties(
          db,
          job,
          user,
          'Quotation rejected',
          `${job.ref}: the customer rejected the quotation. Return the phone.`,
        );
      }
      this.audit(
        db,
        user,
        approve ? 'quotation.approved' : 'quotation.rejected',
        'quotation',
        quote.id,
      );
    });
  }

  /**
   * The customer creates the code they will read out to the courier. It is shown once to
   * them and stored only as a salted hash; generating a new one replaces the old one.
   */
  generateHandoverCode(
    token: string,
    jobId: Id,
  ): { code: string; kind: TaskKind; expiresAt: string } {
    return this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      if (job.customerId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      this.rateLimit(db, `otp:${job.id}`, 6, 10);
      const task = this.activeTask(db, job.id, 'PICKUP') ?? this.activeTask(db, job.id, 'DELIVERY');
      if (!task)
        throw new ApiError('CONFLICT', 'There is no pickup or delivery scheduled right now.');
      const code = this.newOtp(db, task);
      this.audit(db, user, 'otp.generated', 'task', task.id);
      return { code, kind: task.kind, expiresAt: task.otpExpiresAt! };
    });
  }

  addReview(token: string, jobId: Id, input: { rating: number; comment: string }): void {
    const data = parse(reviewSchema, input);
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      if (job.customerId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (!this.reviewable(job))
        throw new ApiError('CONFLICT', 'You can review a job once your phone is back with you.');
      if (db.reviews.some((r) => r.jobId === job.id))
        throw new ApiError('CONFLICT', 'You have already reviewed this job.');
      db.reviews.push({
        id: this.nextId(db, 'rev'),
        jobId: job.id,
        customerId: user.id,
        vendorId: job.vendorId!,
        rating: data.rating as Review['rating'],
        comment: data.comment,
        status: 'PUBLISHED',
        at: this.now(),
      });
      this.notify(
        db,
        job.vendorId!,
        'New review',
        `${job.ref} was rated ${data.rating}/5.`,
        job.id,
      );
    });
  }

  /** Customers may report a bank transfer; it stays unconfirmed until staff verify it. */
  reportTransfer(
    token: string,
    jobId: Id,
    input: { amount: number; reference: string; idempotencyKey: string },
  ): void {
    const data = parse(paymentSchema, { ...input, method: 'BANK_TRANSFER' });
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      if (job.customerId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (!db.settings.enabledPaymentMethods.includes('BANK_TRANSFER')) {
        throw new ApiError('UNAVAILABLE', 'Bank transfers are not enabled.');
      }
      if (!data.reference) throw new ApiError('VALIDATION', 'Enter the transfer reference.');
      if (db.transactions.some((t) => t.idempotencyKey === data.idempotencyKey)) return;
      const f = jobFinancials(job, db.quotations, db.transactions);
      if (f.total === 0) throw new ApiError('CONFLICT', 'There is nothing to pay yet.');
      if (data.amount > f.outstanding)
        throw new ApiError('VALIDATION', `The outstanding balance is Rs ${f.outstanding}.`);
      db.transactions.push({
        id: this.nextId(db, 'txn'),
        jobId: job.id,
        kind: 'PAYMENT',
        method: 'BANK_TRANSFER',
        collector: 'PLATFORM',
        amount: data.amount,
        reference: data.reference,
        idempotencyKey: data.idempotencyKey,
        status: 'PENDING_VERIFICATION',
        recordedBy: user.id,
        at: this.now(),
      });
      this.notifyAdmins(
        db,
        'payments.verify',
        'Transfer to verify',
        `${job.ref}: Rs ${data.amount} (${data.reference}).`,
        job.id,
      );
    });
  }

  // =====================================================================
  // Complaints and support
  // =====================================================================

  raiseComplaint(token: string, input: z.input<typeof complaintSchema>): Complaint {
    const data = parse(complaintSchema, input);
    return this.tx((db) => {
      const user = this.auth(db, token);
      this.requireRole(user, 'CUSTOMER', 'VENDOR');
      this.rateLimit(db, `complaint:${user.id}`, 5, 60);
      let job: RepairJob | undefined;
      if (data.jobId) {
        job = this.job(db, data.jobId);
        if (job.customerId !== user.id && job.vendorId !== user.id)
          throw new ApiError('NOT_FOUND', 'Repair job not found.');
      }
      if (data.isDispute) {
        if (!job || user.role !== 'CUSTOMER')
          throw new ApiError('VALIDATION', 'Disputes must be raised by the customer on a job.');
        if (!['DELIVERED', 'PAID', 'CLOSED'].includes(job.status)) {
          throw new ApiError(
            'CONFLICT',
            'Disputes can be raised after delivery. For other issues, send a complaint.',
          );
        }
      }
      const now = this.now();
      const c: Complaint = {
        id: this.nextId(db, 'cmp'),
        jobId: job?.id,
        raisedBy: user.id,
        subject: data.subject,
        isDispute: data.isDispute,
        status: 'OPEN',
        messages: [{ id: this.nextId(db, 'msg'), authorId: user.id, body: data.body, at: now }],
        createdAt: now,
        updatedAt: now,
      };
      db.complaints.push(c);
      if (job && data.isDispute) {
        job.disputedFrom = job.status;
        this.setStatus(db, job, 'DISPUTED', user, data.subject);
        if (job.vendorId)
          this.notify(db, job.vendorId, 'Job disputed', `${job.ref}: ${data.subject}`, job.id);
      }
      this.notifyAdmins(
        db,
        'complaints.manage',
        data.isDispute ? 'New dispute' : 'New complaint',
        data.subject,
        job?.id,
      );
      this.audit(db, user, 'complaint.raised', 'complaint', c.id, data.subject);
      return c;
    });
  }

  listComplaints(token: string): (Complaint & { jobRef?: string; raisedByName: string })[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      const rows = this.isAdmin(user)
        ? (this.requirePerm(user, 'complaints.manage'), db.complaints)
        : db.complaints.filter(
            (c) =>
              c.raisedBy === user.id ||
              (c.jobId &&
                db.jobs.find((j) => j.id === c.jobId)?.vendorId === user.id &&
                user.role === 'VENDOR'),
          );
      return rows
        .map((c) => ({
          ...c,
          messages: c.messages.map((m) => ({
            ...m,
            authorId: m.authorId,
            author: this.name(db, m.authorId),
          })),
          jobRef: c.jobId ? db.jobs.find((j) => j.id === c.jobId)?.ref : undefined,
          raisedByName: this.name(db, c.raisedBy),
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  replyToComplaint(
    token: string,
    complaintId: Id,
    body: string,
    status?: ComplaintStatus,
    resolution?: string,
  ): void {
    const text = parse(z.string().trim().min(2, 'Write a message.').max(2000), body);
    this.tx((db) => {
      const user = this.auth(db, token);
      const c = db.complaints.find((x) => x.id === complaintId);
      if (!c) throw new ApiError('NOT_FOUND', 'Complaint not found.');
      const admin = this.hasPerm(user, 'complaints.manage');
      const vendorOnJob =
        user.role === 'VENDOR' &&
        !!c.jobId &&
        db.jobs.find((j) => j.id === c.jobId)?.vendorId === user.id;
      if (!admin && c.raisedBy !== user.id && !vendorOnJob)
        throw new ApiError('NOT_FOUND', 'Complaint not found.');
      if (status && !admin)
        throw new ApiError('FORBIDDEN', 'Only support staff can change the status.');
      c.messages.push({
        id: this.nextId(db, 'msg'),
        authorId: user.id,
        body: text,
        at: this.now(),
      });
      if (status) {
        c.status = status;
        if (resolution) c.resolution = resolution.trim();
      } else if (admin && c.status === 'OPEN') c.status = 'IN_REVIEW';
      c.updatedAt = this.now();
      if (c.raisedBy !== user.id)
        this.notify(db, c.raisedBy, 'Update on your complaint', c.subject, c.jobId);
      if (!admin) this.notifyAdmins(db, 'complaints.manage', 'Complaint reply', c.subject, c.jobId);
      if (admin) this.audit(db, user, 'complaint.updated', 'complaint', c.id, status);
    });
  }

  // =====================================================================
  // Vendor: marketplace and assignment
  // =====================================================================

  marketplace(token: string): JobSummary[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      const vendor = this.approvedVendor(db, user);
      return db.jobs
        .filter((j) => j.status === 'AWAITING_VENDOR')
        .filter((j) => {
          const offer = db.assignments.find((a) => a.jobId === j.id && a.state === 'OFFERED');
          if (offer) return offer.vendorId === user.id;
          return db.settings.assignmentMode === 'FIRST_ACCEPT' && this.eligible(db, vendor, j);
        })
        .map((j) =>
          this.summary(
            db,
            j,
            user,
            db.assignments.some(
              (a) => a.jobId === j.id && a.state === 'OFFERED' && a.vendorId === user.id,
            ),
          ),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }

  /**
   * Claims a job. Runs in one transaction against the latest stored state, so of two
   * vendors who saw the same job only the first succeeds; the second gets a conflict.
   */
  acceptJob(token: string, jobId: Id, expectedVersion?: number): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      const vendor = this.approvedVendor(db, user);
      this.rateLimit(db, `accept:${user.id}`, 30, 10);
      const job = this.job(db, jobId);
      if (job.vendorId || job.status !== 'AWAITING_VENDOR') {
        throw new ApiError('CONFLICT', 'Sorry, this job has already been taken by another vendor.');
      }
      this.checkVersion(job, expectedVersion);
      const offer = db.assignments.find((a) => a.jobId === job.id && a.state === 'OFFERED');
      if (offer) {
        if (offer.vendorId !== user.id)
          throw new ApiError('CONFLICT', 'This job has been offered to another vendor.');
        offer.state = 'ACCEPTED';
        offer.respondedAt = this.now();
      } else {
        if (db.settings.assignmentMode !== 'FIRST_ACCEPT' || !this.eligible(db, vendor, job)) {
          throw new ApiError('FORBIDDEN', 'You are not eligible for this job.');
        }
        db.assignments.push({
          id: this.nextId(db, 'asg'),
          jobId: job.id,
          vendorId: user.id,
          mode: 'FIRST_ACCEPT',
          state: 'ACCEPTED',
          offeredAt: job.updatedAt,
          respondedAt: this.now(),
        });
      }
      job.vendorId = user.id;
      this.setStatus(db, job, 'VENDOR_ACCEPTED', user, undefined, undefined, 'VENDOR');
      this.notify(
        db,
        job.customerId,
        'Repair shop found',
        `${vendor.shopName} accepted ${job.ref} and will schedule a pickup.`,
        job.id,
      );
      this.audit(db, user, 'job.accepted', 'job', job.id);
    });
  }

  declineOffer(token: string, jobId: Id, reason: string): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.approvedVendor(db, user);
      const job = this.job(db, jobId);
      const offer = db.assignments.find(
        (a) => a.jobId === job.id && a.state === 'OFFERED' && a.vendorId === user.id,
      );
      if (!offer) throw new ApiError('CONFLICT', 'There is no pending offer for you on this job.');
      offer.state = 'DECLINED';
      offer.respondedAt = this.now();
      offer.note = reason.trim() || undefined;
      this.setStatus(
        db,
        job,
        'SUBMITTED',
        user,
        `Declined: ${reason || 'no reason given'}`,
        undefined,
        'VENDOR',
      );
      this.notifyAdmins(
        db,
        'jobs.assign',
        'Assignment declined',
        `${job.ref} needs another vendor.`,
        job.id,
      );
      this.audit(db, user, 'job.declined', 'job', job.id, reason);
    });
  }

  /** Admin assignment (mode B) and reassignment. Returns a job to the vendor queue first if needed. */
  assignVendor(token: string, jobId: Id, vendorId: Id, note = ''): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'jobs.assign');
      const job = this.job(db, jobId);
      const vendor = db.vendors.find((v) => v.userId === vendorId);
      if (!vendor || vendor.status !== 'APPROVED')
        throw new ApiError('VALIDATION', 'Choose an approved vendor.');
      if (job.vendorId === vendorId)
        throw new ApiError('CONFLICT', 'That vendor already has this job.');
      if (job.status === 'VENDOR_ACCEPTED') {
        // Reassigning after acceptance: release the old vendor first.
        const prev = job.vendorId!;
        for (const a of db.assignments)
          if (a.jobId === job.id && a.state === 'ACCEPTED') a.state = 'REVOKED';
        job.vendorId = undefined;
        this.setStatus(db, job, 'SUBMITTED', user, 'Reassigned by operations.', undefined, 'ADMIN');
        this.notify(db, prev, 'Job reassigned', `${job.ref} was reassigned to another shop.`);
      } else if (job.status === 'AWAITING_VENDOR') {
        for (const a of db.assignments)
          if (a.jobId === job.id && a.state === 'OFFERED') a.state = 'REVOKED';
        this.setStatus(
          db,
          job,
          'SUBMITTED',
          user,
          'Offer withdrawn for reassignment.',
          undefined,
          'ADMIN',
        );
      } else if (job.status !== 'SUBMITTED') {
        throw new ApiError('CONFLICT', 'Only jobs that have not been picked up can be assigned.');
      }
      const now = this.clock();
      db.assignments.push({
        id: this.nextId(db, 'asg'),
        jobId: job.id,
        vendorId,
        mode: 'ADMIN_ASSIGN',
        state: 'OFFERED',
        offeredAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + db.settings.acceptanceTimeoutHours * 3_600_000,
        ).toISOString(),
        assignedBy: user.id,
        note: note.trim() || undefined,
      });
      this.setStatus(
        db,
        job,
        'AWAITING_VENDOR',
        user,
        `Offered to ${vendor.shopName}.`,
        undefined,
        'ADMIN',
      );
      this.notify(
        db,
        vendorId,
        'Job assigned to you',
        `${job.ref}: please accept or decline within ${db.settings.acceptanceTimeoutHours}h.`,
        job.id,
      );
      this.audit(db, user, 'job.assigned', 'job', job.id, vendor.shopName);
    });
  }

  /** Admin publishes a queued job to the open marketplace. */
  publishJob(token: string, jobId: Id): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'jobs.assign');
      const job = this.job(db, jobId);
      if (job.status !== 'SUBMITTED')
        throw new ApiError('CONFLICT', 'Only queued requests can be published.');
      if (db.settings.assignmentMode !== 'FIRST_ACCEPT') {
        throw new ApiError(
          'CONFLICT',
          'Switch to first-accept mode to publish jobs, or assign a vendor.',
        );
      }
      this.publish(db, job, user);
      this.audit(db, user, 'job.published', 'job', job.id);
    });
  }

  // =====================================================================
  // Vendor / agent: pickup, workshop, delivery
  // =====================================================================

  /** Fires a transition that has no side effects (see `Transition.plain`). */
  advance(
    token: string,
    jobId: Id,
    to: JobStatus,
    note = '',
    fileIds: Id[] = [],
    expectedVersion?: number,
  ): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      this.checkVersion(job, expectedVersion);
      const tr = findTransition(job.status, to);
      if (!tr || !tr.plain) throw new ApiError('CONFLICT', 'That step is not available from here.');
      if (tr.needsNote && note.trim().length < 3)
        throw new ApiError('VALIDATION', 'Please add a short reason.');
      if (user.role === 'VENDOR') this.approvedVendor(db, user);
      this.ownsFile(db, user, fileIds, job.id);
      this.setStatus(db, job, to, user, note, fileIds);
      const pickup = this.activeTask(db, job.id, 'PICKUP');
      const delivery = this.activeTask(db, job.id, 'DELIVERY');
      if (to === 'PICKUP_IN_PROGRESS' && pickup) this.taskStatus(pickup, 'IN_PROGRESS', user);
      if (to === 'OUT_FOR_DELIVERY' && delivery) this.taskStatus(delivery, 'IN_PROGRESS', user);
      if (to === 'PICKUP_FAILED' || to === 'CUSTOMER_UNAVAILABLE') {
        const task = pickup ?? delivery;
        if (task) {
          this.taskStatus(task, 'FAILED', user, note);
          task.failureReason = note;
        }
        job.failureReason = note;
      }
      if (to === 'WAITING_FOR_PARTS') {
        db.workLogs.push({
          id: this.nextId(db, 'log'),
          jobId: job.id,
          kind: 'DELAY',
          note,
          fileIds: [],
          recordedBy: user.id,
          at: this.now(),
        });
      }
      const meta: Partial<Record<JobStatus, string>> = {
        PICKUP_IN_PROGRESS: 'Your courier is on the way to collect the phone.',
        RECEIVED_AT_SHOP: 'Your phone has arrived at the repair shop.',
        INSPECTION_IN_PROGRESS: 'The technician is inspecting your phone.',
        REPAIR_IN_PROGRESS: 'Repair work has started.',
        WAITING_FOR_PARTS: `Repair delayed: ${note}`,
        REPAIR_COMPLETED: 'The repair is complete and going through a quality check.',
        OUT_FOR_DELIVERY: 'Your phone is on its way back to you. Have your handover code ready.',
        PICKUP_FAILED: `Pickup failed: ${note}`,
        CUSTOMER_UNAVAILABLE: `We could not reach you: ${note}`,
      };
      if (meta[to]) this.notifyParties(db, job, user, `${job.ref} update`, meta[to]!);
      this.audit(db, user, 'job.status', 'job', job.id, to);
    });
  }

  schedulePickup(token: string, jobId: Id, input: ScheduleInput): void {
    const data = parse(scheduleSchema, input);
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const kind = this.actorKind(db, user, job);
      if (!kind) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (kind === 'VENDOR') this.approvedVendor(db, user);
      if (job.status === 'CUSTOMER_UNAVAILABLE' && job.collectedAt) {
        throw new ApiError(
          'CONFLICT',
          'The phone has already been collected; reschedule the delivery instead.',
        );
      }
      if (data.date < this.now().slice(0, 10))
        throw new ApiError('VALIDATION', 'Choose today or a later date.');
      const existing = this.activeTask(db, job.id, 'PICKUP');
      if (existing) {
        this.taskStatus(existing, 'RESCHEDULED', user, data.note);
      }
      this.createTask(db, job, 'PICKUP', data, user);
      const note = `Pickup on ${data.date}, ${data.window}.${data.note ? ' ' + data.note : ''}`;
      this.setStatus(db, job, 'PICKUP_SCHEDULED', user, note, undefined, kind);
      this.notifyParties(
        db,
        job,
        user,
        existing || job.failureReason ? 'Pickup rescheduled' : 'Pickup scheduled',
        `${job.ref}: ${note}`,
      );
      this.audit(db, user, 'pickup.scheduled', 'job', job.id, note);
    });
  }

  /** Collection needs the customer's handover code and a condition report. */
  confirmCollection(token: string, jobId: Id, otp: string, condition: ConditionInput): void {
    const report = parse(conditionSchema, condition);
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const kind = this.actorKind(db, user, job);
      if (kind !== 'VENDOR' && kind !== 'AGENT')
        throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (job.status !== 'PICKUP_IN_PROGRESS')
        throw new ApiError('CONFLICT', 'Start the pickup first.');
      const task = this.activeTask(db, job.id, 'PICKUP');
      if (!task || task.assigneeId !== user.id)
        throw new ApiError('FORBIDDEN', 'This pickup is assigned to someone else.');
      this.verifyOtp(db, task, otp);
      this.ownsFile(db, user, report.photoIds, job.id);
      db.conditions.push({
        id: this.nextId(db, 'cond'),
        jobId: job.id,
        stage: 'PICKUP',
        ...report,
        recordedBy: user.id,
        at: this.now(),
      });
      task.evidenceIds.push(...report.photoIds);
      this.taskStatus(task, 'COMPLETED', user, 'Handover code verified.');
      job.collectedAt = this.now();
      this.setStatus(
        db,
        job,
        'PHONE_COLLECTED',
        user,
        'Collected; handover code verified.',
        report.photoIds,
        kind,
      );
      this.notifyParties(
        db,
        job,
        user,
        'Phone collected',
        `${job.ref}: your phone has been collected.`,
      );
      this.audit(db, user, 'pickup.completed', 'job', job.id);
    });
  }

  /** Records the inspection and submits a quotation, or a revised one during repair. */
  submitQuotation(token: string, jobId: Id, input: QuotationInput): void {
    const data = parse(quotationSchema, input);
    this.tx((db) => {
      const user = this.auth(db, token);
      this.approvedVendor(db, user);
      const job = this.job(db, jobId);
      if (job.vendorId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (
        !['INSPECTION_IN_PROGRESS', 'REPAIR_IN_PROGRESS', 'WAITING_FOR_PARTS'].includes(job.status)
      ) {
        throw new ApiError(
          'CONFLICT',
          'Quotations can be sent during inspection or, as a revision, during repair.',
        );
      }
      if (data.estimatedCompletion < this.now().slice(0, 10))
        throw new ApiError('VALIDATION', 'The completion date cannot be in the past.');
      const totals = quoteTotals(data.items, data.discount, db.settings.taxRatePct);
      if (data.discount > totals.subtotal)
        throw new ApiError('VALIDATION', 'Discount cannot exceed the subtotal.');
      const revision = job.status !== 'INSPECTION_IN_PROGRESS';
      db.inspections.push({
        id: this.nextId(db, 'insp'),
        jobId: job.id,
        findings: data.findings,
        proposedRepair: data.proposedRepair,
        repairable: true,
        recordedBy: user.id,
        at: this.now(),
      });
      for (const q of db.quotations)
        if (q.jobId === job.id && q.status === 'PENDING') q.status = 'SUPERSEDED';
      const version = db.quotations.filter((q) => q.jobId === job.id).length + 1;
      const quote: RepairQuotation = {
        id: this.nextId(db, 'quo'),
        jobId: job.id,
        version,
        items: data.items,
        discount: data.discount,
        taxRatePct: db.settings.taxRatePct,
        estimatedCompletion: new Date(`${data.estimatedCompletion}T18:00:00+05:00`).toISOString(),
        warrantyDays: data.warrantyDays,
        notes: data.notes,
        commissionPct: db.settings.commissionPct,
        commissionFixed: db.settings.commissionFixed,
        status: 'PENDING',
        createdBy: user.id,
        createdAt: this.now(),
      };
      db.quotations.push(quote);
      this.setStatus(
        db,
        job,
        'QUOTATION_SUBMITTED',
        user,
        `${revision ? 'Revised quotation' : 'Quotation'} v${version}: Rs ${totals.total}.`,
      );
      this.setStatus(
        db,
        job,
        'AWAITING_APPROVAL',
        'system',
        'Waiting for the customer to approve.',
      );
      this.notify(
        db,
        job.customerId,
        revision ? 'Additional charges need approval' : 'Quotation ready',
        `${job.ref}: Rs ${totals.total}. Review and approve to continue.`,
        job.id,
      );
      this.audit(
        db,
        user,
        'quotation.submitted',
        'quotation',
        quote.id,
        `v${version} Rs ${totals.total}`,
      );
    });
  }

  markUnrepairable(token: string, jobId: Id, findings: string): void {
    const note = parse(
      z.string().trim().min(5, 'Describe why it cannot be repaired.').max(1000),
      findings,
    );
    this.tx((db) => {
      const user = this.auth(db, token);
      this.approvedVendor(db, user);
      const job = this.job(db, jobId);
      if (job.vendorId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      db.inspections.push({
        id: this.nextId(db, 'insp'),
        jobId: job.id,
        findings: note,
        proposedRepair: '—',
        repairable: false,
        recordedBy: user.id,
        at: this.now(),
      });
      job.outcome = 'NOT_REPAIRED';
      this.setStatus(db, job, 'UNREPAIRABLE', user, note);
      this.notifyParties(db, job, user, 'Phone cannot be repaired', `${job.ref}: ${note}`);
      this.audit(db, user, 'job.unrepairable', 'job', job.id);
    });
  }

  addPart(
    token: string,
    jobId: Id,
    part: { partName: string; partNumber?: string; quantity: number; unitCost: number },
  ): void {
    const data = parse(
      z.object({
        partName: z.string().trim().min(2).max(80),
        partNumber: z.string().trim().max(40).optional(),
        quantity: z.number().int().min(1).max(20),
        unitCost: z.number().int().min(0).max(500_000),
      }),
      part,
    );
    this.tx((db) => {
      const user = this.auth(db, token);
      this.approvedVendor(db, user);
      const job = this.job(db, jobId);
      if (job.vendorId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (!['REPAIR_IN_PROGRESS', 'WAITING_FOR_PARTS'].includes(job.status)) {
        throw new ApiError('CONFLICT', 'Parts are recorded during the repair.');
      }
      db.parts.push({
        id: this.nextId(db, 'part'),
        jobId: job.id,
        ...data,
        recordedBy: user.id,
        at: this.now(),
      });
    });
  }

  addWorkLog(
    token: string,
    jobId: Id,
    kind: RepairWorkLog['kind'],
    note: string,
    fileIds: Id[] = [],
  ): void {
    const text = parse(z.string().trim().min(2, 'Write a note.').max(1000), note);
    this.tx((db) => {
      const user = this.auth(db, token);
      this.approvedVendor(db, user);
      const job = this.job(db, jobId);
      if (job.vendorId !== user.id) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (!job.collectedAt || COMPLETED_STATUSES.includes(job.status)) {
        throw new ApiError('CONFLICT', 'Workshop notes can be added while the phone is with you.');
      }
      this.ownsFile(db, user, fileIds, job.id);
      db.workLogs.push({
        id: this.nextId(db, 'log'),
        jobId: job.id,
        kind,
        note: text,
        fileIds,
        recordedBy: user.id,
        at: this.now(),
      });
      if (kind === 'DELAY')
        this.notify(db, job.customerId, 'Repair delayed', `${job.ref}: ${text}`, job.id);
    });
  }

  /** Books the return trip: after QC, after a rejected quote, or for an unrepairable phone. */
  scheduleDelivery(token: string, jobId: Id, input: ScheduleInput): void {
    const data = parse(scheduleSchema, input);
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const kind = this.actorKind(db, user, job);
      if (!kind) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (kind === 'VENDOR') this.approvedVendor(db, user);
      if (job.status === 'CUSTOMER_UNAVAILABLE' && !job.collectedAt) {
        throw new ApiError(
          'CONFLICT',
          'The phone has not been collected yet; reschedule the pickup instead.',
        );
      }
      if (data.date < this.now().slice(0, 10))
        throw new ApiError('VALIDATION', 'Choose today or a later date.');
      if (job.status === 'QUALITY_CHECKED') job.outcome = 'REPAIRED';
      const existing = this.activeTask(db, job.id, 'DELIVERY');
      if (existing) this.taskStatus(existing, 'RESCHEDULED', user, data.note);
      this.createTask(db, job, 'DELIVERY', data, user);
      const note = `Delivery on ${data.date}, ${data.window}.${data.note ? ' ' + data.note : ''}`;
      this.setStatus(db, job, 'READY_FOR_DELIVERY', user, note, undefined, kind);
      this.notifyParties(
        db,
        job,
        user,
        job.outcome === 'REPAIRED' ? 'Repair ready' : 'Phone being returned',
        `${job.ref}: ${note}`,
      );
      this.audit(db, user, 'delivery.scheduled', 'job', job.id, note);
    });
  }

  confirmDelivery(token: string, jobId: Id, otp: string, note = '', fileIds: Id[] = []): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const kind = this.actorKind(db, user, job);
      if (kind !== 'VENDOR' && kind !== 'AGENT')
        throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (job.status !== 'OUT_FOR_DELIVERY')
        throw new ApiError('CONFLICT', 'Mark the phone out for delivery first.');
      const task = this.activeTask(db, job.id, 'DELIVERY');
      if (!task || task.assigneeId !== user.id)
        throw new ApiError('FORBIDDEN', 'This delivery is assigned to someone else.');
      this.verifyOtp(db, task, otp);
      this.ownsFile(db, user, fileIds, job.id);
      task.evidenceIds.push(...fileIds);
      this.taskStatus(task, 'COMPLETED', user, note || 'Handover code verified.');
      this.setStatus(
        db,
        job,
        'DELIVERED',
        user,
        note || 'Delivered; handover code verified.',
        fileIds,
        kind,
      );
      const quote = db.quotations.find((q) => q.jobId === job.id && q.status === 'APPROVED');
      if (job.outcome === 'REPAIRED' && quote && quote.warrantyDays > 0) {
        const start = this.clock();
        db.warranties.push({
          id: this.nextId(db, 'war'),
          jobId: job.id,
          days: quote.warrantyDays,
          terms:
            'Covers the replaced parts and workmanship. Excludes physical or liquid damage after delivery.',
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + quote.warrantyDays * 86_400_000).toISOString(),
        });
      }
      const f = jobFinancials(job, db.quotations, db.transactions);
      if (f.total > 0 && !db.invoices.some((i) => i.jobId === job.id)) {
        db.invoices.push({
          id: this.nextId(db, 'inv'),
          jobId: job.id,
          number: `INV-${this.now().slice(0, 4)}-${db.seq}`,
          issuedAt: this.now(),
          quotationId: quote?.id ?? '',
        });
      }
      this.notifyParties(
        db,
        job,
        user,
        'Phone delivered',
        `${job.ref} was delivered.${f.outstanding ? ` Rs ${f.outstanding} is due.` : ''}`,
      );
      this.settleIfPossible(db, job);
      this.audit(db, user, 'delivery.completed', 'job', job.id);
    });
  }

  closeJob(token: string, jobId: Id, note = ''): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const kind = this.actorKind(db, user, job);
      if (!kind) throw new ApiError('NOT_FOUND', 'Repair job not found.');
      if (job.status === 'DISPUTED' && note.trim().length < 3)
        throw new ApiError('VALIDATION', 'Add a resolution note.');
      if (
        job.status === 'DELIVERED' &&
        jobFinancials(job, db.quotations, db.transactions).outstanding > 0
      ) {
        throw new ApiError('CONFLICT', 'Record the payment before closing the job.');
      }
      this.setStatus(db, job, 'CLOSED', user, note || 'Job closed.', undefined, kind);
      if (kind === 'ADMIN') {
        for (const c of db.complaints)
          if (c.jobId === job.id && c.isDispute && c.status !== 'RESOLVED') {
            c.status = 'RESOLVED';
            c.resolution = note;
            c.updatedAt = this.now();
          }
      }
      this.notifyParties(db, job, user, 'Job closed', `${job.ref} is closed.`);
      this.audit(db, user, 'job.closed', 'job', job.id, note);
    });
  }

  // =====================================================================
  // Payments, refunds, settlements
  // =====================================================================

  /**
   * Records money received. Vendors record cash they took; agents record cash on
   * delivery for the platform; staff record and confirm bank transfers. The
   * idempotency key makes retries and double-clicks safe.
   */
  recordPayment(
    token: string,
    jobId: Id,
    input: { method: PaymentMethod; amount: number; reference?: string; idempotencyKey: string },
  ): PaymentTransaction {
    const data = parse(paymentSchema, input);
    return this.tx((db) => {
      const user = this.auth(db, token);
      const job = this.job(db, jobId);
      const dup = db.transactions.find((t) => t.idempotencyKey === data.idempotencyKey);
      if (dup) {
        if (dup.jobId !== job.id) throw new ApiError('CONFLICT', 'Duplicate payment reference.');
        return dup;
      }
      const kind = this.actorKind(db, user, job);
      const admin = this.hasPerm(user, 'payments.verify');
      if (kind !== 'VENDOR' && kind !== 'AGENT' && !admin)
        throw new ApiError('FORBIDDEN', 'You cannot record payments on this job.');
      if (data.method === 'ONLINE') {
        throw new ApiError(
          'UNAVAILABLE',
          'Online payments are confirmed by the payment gateway, not recorded by hand.',
        );
      }
      if (!db.settings.enabledPaymentMethods.includes(data.method))
        throw new ApiError('UNAVAILABLE', 'That payment method is turned off.');
      if (kind === 'VENDOR' && data.method === 'BANK_TRANSFER')
        throw new ApiError('FORBIDDEN', 'Bank transfers are confirmed by the platform.');
      if (['SUBMITTED', 'AWAITING_VENDOR', 'CANCELLED', 'REFUNDED'].includes(job.status)) {
        throw new ApiError('CONFLICT', 'Payments cannot be recorded at this stage.');
      }
      const f = jobFinancials(job, db.quotations, db.transactions);
      if (f.total === 0)
        throw new ApiError('CONFLICT', 'There is no approved amount to collect yet.');
      if (data.amount > f.outstanding)
        throw new ApiError('VALIDATION', `The outstanding balance is only Rs ${f.outstanding}.`);
      const collector = kind === 'VENDOR' ? 'VENDOR' : 'PLATFORM';
      const txn: PaymentTransaction = {
        id: this.nextId(db, 'txn'),
        jobId: job.id,
        kind: 'PAYMENT',
        method: data.method,
        collector,
        amount: data.amount,
        reference: data.reference,
        idempotencyKey: data.idempotencyKey,
        status: 'CONFIRMED',
        recordedBy: user.id,
        verifiedBy: admin ? user.id : undefined,
        at: this.now(),
      };
      db.transactions.push(txn);
      this.notify(
        db,
        job.customerId,
        'Payment received',
        `${job.ref}: Rs ${data.amount} received. Thank you.`,
        job.id,
      );
      this.settleIfPossible(db, job);
      this.audit(db, user, 'payment.recorded', 'job', job.id, `Rs ${data.amount} ${data.method}`);
      return txn;
    });
  }

  verifyTransfer(token: string, transactionId: Id): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'payments.verify');
      const t = db.transactions.find((x) => x.id === transactionId);
      if (!t || t.status !== 'PENDING_VERIFICATION')
        throw new ApiError('CONFLICT', 'Nothing to verify.');
      const job = this.job(db, t.jobId);
      const f = jobFinancials(job, db.quotations, db.transactions);
      if (t.amount > f.outstanding)
        throw new ApiError(
          'CONFLICT',
          `Only Rs ${f.outstanding} is outstanding; reject this transfer instead.`,
        );
      t.status = 'CONFIRMED';
      t.verifiedBy = user.id;
      this.notify(
        db,
        job.customerId,
        'Payment confirmed',
        `${job.ref}: your transfer of Rs ${t.amount} was confirmed.`,
        job.id,
      );
      this.settleIfPossible(db, job);
      this.audit(db, user, 'payment.verified', 'transaction', t.id);
    });
  }

  /**
   * Payment gateway webhook. Verifies the signature and ignores replays of the same event,
   * so a gateway retrying delivery can never double-count a payment.
   */
  gatewayWebhook(payload: {
    eventId: string;
    jobId: Id;
    amount: number;
    signature: string;
  }): 'RECORDED' | 'DUPLICATE' {
    return this.tx((db) => {
      if (!db.settings.onlineGateway.configured || !db.secrets.gatewayWebhookSecret) {
        throw new ApiError('UNAVAILABLE', 'No payment gateway is configured.');
      }
      const expected = sha256(
        `${db.secrets.gatewayWebhookSecret}|${payload.eventId}|${payload.jobId}|${payload.amount}`,
      );
      if (!safeEqual(expected, payload.signature))
        throw new ApiError('FORBIDDEN', 'Invalid webhook signature.');
      const key = `gateway:${payload.eventId}`;
      if (db.transactions.some((t) => t.idempotencyKey === key)) return 'DUPLICATE';
      const job = this.job(db, payload.jobId);
      db.transactions.push({
        id: this.nextId(db, 'txn'),
        jobId: job.id,
        kind: 'PAYMENT',
        method: 'ONLINE',
        collector: 'PLATFORM',
        amount: payload.amount,
        reference: payload.eventId,
        idempotencyKey: key,
        status: 'CONFIRMED',
        recordedBy: 'system',
        at: this.now(),
      });
      this.notify(
        db,
        job.customerId,
        'Payment received',
        `${job.ref}: Rs ${payload.amount} paid online.`,
        job.id,
      );
      this.settleIfPossible(db, job);
      this.audit(db, 'system', 'payment.webhook', 'job', job.id, payload.eventId);
      return 'RECORDED';
    });
  }

  issueRefund(
    token: string,
    jobId: Id,
    input: {
      amount: number;
      reason: string;
      collector: 'PLATFORM' | 'VENDOR';
      idempotencyKey: string;
    },
  ): void {
    const data = parse(refundSchema, input);
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'refunds.issue');
      if (db.transactions.some((t) => t.idempotencyKey === data.idempotencyKey)) return;
      const job = this.job(db, jobId);
      const f = jobFinancials(job, db.quotations, db.transactions);
      const refundable = f.paid - f.refunded;
      if (data.amount > refundable)
        throw new ApiError('VALIDATION', `At most Rs ${refundable} can be refunded.`);
      db.transactions.push({
        id: this.nextId(db, 'txn'),
        jobId: job.id,
        kind: 'REFUND',
        method: data.collector === 'VENDOR' ? 'CASH_TO_VENDOR' : 'BANK_TRANSFER',
        collector: data.collector,
        amount: data.amount,
        idempotencyKey: data.idempotencyKey,
        status: 'CONFIRMED',
        recordedBy: user.id,
        reason: data.reason,
        at: this.now(),
      });
      if (job.status === 'DISPUTED' && data.amount === refundable) {
        this.setStatus(db, job, 'REFUNDED', 'system', `Refunded Rs ${data.amount}: ${data.reason}`);
        for (const c of db.complaints)
          if (c.jobId === job.id && c.isDispute && c.status !== 'RESOLVED') {
            c.status = 'RESOLVED';
            c.resolution = `Refunded Rs ${data.amount}.`;
            c.updatedAt = this.now();
          }
      }
      this.notifyParties(
        db,
        job,
        user,
        'Refund processed',
        `${job.ref}: Rs ${data.amount} refunded. ${data.reason}`,
      );
      this.audit(db, user, 'refund.issued', 'job', job.id, `Rs ${data.amount}: ${data.reason}`);
    });
  }

  vendorBalances(
    token: string,
  ): (VendorBalance & {
    vendorId: Id;
    shopName: string;
    payout?: { bankName: string; last4: string };
  })[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'settlements.manage');
      return db.vendors
        .filter((v) => v.status !== 'PENDING' && v.status !== 'REJECTED')
        .map((v) => ({
          vendorId: v.userId,
          shopName: v.shopName,
          payout: v.payout
            ? { bankName: v.payout.bankName, last4: v.payout.iban.slice(-4) }
            : undefined,
          ...vendorBalance(v.userId, db.jobs, db.quotations, db.transactions, db.settlements),
        }));
    });
  }

  createSettlement(token: string, vendorId: Id, amount: number, reference: string): void {
    const ref = parse(z.string().trim().min(3, 'Enter a payment reference.').max(60), reference);
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'settlements.manage');
      if (!Number.isInteger(amount) || amount === 0)
        throw new ApiError('VALIDATION', 'Enter a non-zero whole amount.');
      const b = vendorBalance(vendorId, db.jobs, db.quotations, db.transactions, db.settlements);
      if (Math.sign(amount) !== Math.sign(b.balance) || Math.abs(amount) > Math.abs(b.balance)) {
        throw new ApiError(
          'VALIDATION',
          `The settlement must not exceed the open balance of Rs ${b.balance}.`,
        );
      }
      const last = db.settlements.filter((s) => s.vendorId === vendorId).at(-1);
      const s: VendorSettlement = {
        id: this.nextId(db, 'stl'),
        vendorId,
        amount,
        reference: ref,
        periodFrom:
          last?.periodTo ?? db.vendors.find((v) => v.userId === vendorId)!.termsAcceptedAt,
        periodTo: this.now(),
        createdBy: user.id,
        at: this.now(),
      };
      db.settlements.push(s);
      this.notify(
        db,
        vendorId,
        'Settlement recorded',
        amount > 0
          ? `Rs ${amount} paid to you (${ref}).`
          : `Rs ${-amount} received from you (${ref}).`,
      );
      this.audit(db, user, 'settlement.created', 'vendor', vendorId, `Rs ${amount} ${ref}`);
    });
  }

  /** Ledger for finance screens: every transaction with its job reference. */
  ledger(token: string): (PaymentTransaction & { jobRef: string; vendorName?: string })[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'payments.verify');
      return db.transactions
        .map((t) => {
          const job = db.jobs.find((j) => j.id === t.jobId);
          return {
            ...t,
            jobRef: job?.ref ?? '—',
            vendorName: job?.vendorId
              ? db.vendors.find((v) => v.userId === job.vendorId)?.shopName
              : undefined,
          };
        })
        .sort((a, b) => b.at.localeCompare(a.at));
    });
  }

  settlements(token: string): (VendorSettlement & { shopName: string })[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      const rows =
        user.role === 'VENDOR'
          ? db.settlements.filter((s) => s.vendorId === user.id)
          : (this.requirePerm(user, 'settlements.manage'), db.settlements);
      return rows
        .map((s) => ({
          ...s,
          shopName: db.vendors.find((v) => v.userId === s.vendorId)?.shopName ?? '—',
        }))
        .sort((a, b) => b.at.localeCompare(a.at));
    });
  }

  // =====================================================================
  // Vendor self-service
  // =====================================================================

  vendorDashboard(token: string) {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requireRole(user, 'VENDOR');
      const vendor = db.vendors.find((v) => v.userId === user.id)!;
      const mine = db.jobs.filter((j) => j.vendorId === user.id);
      const offers = db.assignments.filter((a) => a.vendorId === user.id);
      const responded = offers.filter((a) => a.mode === 'ADMIN_ASSIGN' && a.state !== 'OFFERED');
      const completed = mine.filter((j) => COMPLETED_STATUSES.includes(j.status));
      const withPromise = completed.filter((j) => j.promisedAt);
      const deliveredOnTime = withPromise.filter((j) => {
        const d = db.history.find((h) => h.jobId === j.id && h.to === 'DELIVERED');
        return d && d.at <= j.promisedAt!;
      });
      const reviews = db.reviews.filter((r) => r.vendorId === user.id && r.status === 'PUBLISHED');
      const complaints = db.complaints.filter((c) => c.jobId && mine.some((j) => j.id === c.jobId));
      const customers = new Map<string, number>();
      for (const j of mine) customers.set(j.customerId, (customers.get(j.customerId) ?? 0) + 1);
      const durations = completed
        .map((j) => {
          const start = db.history.find((h) => h.jobId === j.id && h.to === 'RECEIVED_AT_SHOP');
          const end = db.history.find((h) => h.jobId === j.id && h.to === 'READY_FOR_DELIVERY');
          return start && end ? (Date.parse(end.at) - Date.parse(start.at)) / 3_600_000 : null;
        })
        .filter((x): x is number => x !== null);
      return {
        vendor,
        status: vendor.status,
        available: vendor.status === 'APPROVED' ? this.marketplaceCount(db, user, vendor) : 0,
        accepted: mine.filter(
          (j) =>
            [
              'VENDOR_ACCEPTED',
              'PICKUP_SCHEDULED',
              'PICKUP_IN_PROGRESS',
              'PICKUP_FAILED',
              'CUSTOMER_UNAVAILABLE',
            ].includes(j.status) && !j.collectedAt,
        ).length,
        activeRepairs: mine.filter(
          (j) =>
            j.collectedAt &&
            ACTIVE_STATUSES.includes(j.status) &&
            !['DELIVERED', 'DISPUTED'].includes(j.status),
        ).length,
        completed: completed.length,
        balance: vendorBalance(user.id, db.jobs, db.quotations, db.transactions, db.settlements),
        performance: {
          acceptanceRate: responded.length
            ? responded.filter((a) => a.state === 'ACCEPTED').length / responded.length
            : null,
          completionRate: mine.length ? completed.length / mine.length : null,
          cancellationRate: mine.length
            ? mine.filter((j) => j.status === 'CANCELLED').length / mine.length
            : null,
          avgRepairHours: durations.length
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : null,
          onTimeRate: withPromise.length ? deliveredOnTime.length / withPromise.length : null,
          rating: reviews.length
            ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
            : null,
          reviewCount: reviews.length,
          complaintRate: mine.length ? complaints.length / mine.length : null,
          repeatCustomers: [...customers.values()].filter((n) => n > 1).length,
        },
        reviews: reviews
          .map((r) => ({
            ...r,
            jobRef: db.jobs.find((j) => j.id === r.jobId)?.ref,
            customerName: db.users.find((u) => u.id === r.customerId)?.name.split(' ')[0],
          }))
          .sort((a, b) => b.at.localeCompare(a.at)),
        earningsByJob: completed
          .map((j) => ({
            id: j.id,
            ref: j.ref,
            status: j.status,
            updatedAt: j.updatedAt,
            ...jobFinancials(j, db.quotations, db.transactions),
          }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      };
    });
  }

  private marketplaceCount(db: Db, user: User, vendor: VendorProfile): number {
    return db.jobs.filter((j) => {
      if (j.status !== 'AWAITING_VENDOR') return false;
      const offer = db.assignments.find((a) => a.jobId === j.id && a.state === 'OFFERED');
      if (offer) return offer.vendorId === user.id;
      return db.settings.assignmentMode === 'FIRST_ACCEPT' && this.eligible(db, vendor, j);
    }).length;
  }

  updateVendorProfile(
    token: string,
    input: Partial<
      Pick<
        VendorProfile,
        'shopName' | 'serviceAreas' | 'specialties' | 'brands' | 'available' | 'hours' | 'bio'
      >
    >,
  ): VendorProfile {
    return this.tx((db) => {
      const user = this.auth(db, token);
      this.requireRole(user, 'VENDOR');
      const v = db.vendors.find((x) => x.userId === user.id)!;
      if (input.shopName !== undefined)
        v.shopName = parse(z.string().trim().min(2).max(80), input.shopName);
      if (input.serviceAreas)
        v.serviceAreas = parse(
          z.array(z.string()).min(1, 'Keep at least one service area.'),
          input.serviceAreas,
        );
      if (input.specialties)
        v.specialties = parse(
          z.array(z.string()).min(1, 'Keep at least one specialty.'),
          input.specialties,
        );
      if (input.brands)
        v.brands = parse(z.array(z.string()).min(1, 'Keep at least one brand.'), input.brands);
      if (input.available !== undefined) v.available = !!input.available;
      if (input.bio !== undefined)
        v.bio = parse(z.string().trim().max(400), input.bio) || undefined;
      if (input.hours) {
        v.hours = parse(
          z
            .object({
              days: z
                .array(z.number().int().min(0).max(6))
                .min(1, 'Pick at least one working day.'),
              open: z.string().regex(/^\d{2}:\d{2}$/),
              close: z.string().regex(/^\d{2}:\d{2}$/),
            })
            .refine((h) => h.open < h.close, 'Closing time must be after opening time.'),
          input.hours,
        );
      }
      this.audit(db, user, 'vendor.profile-updated', 'vendor', user.id);
      return v;
    });
  }

  // =====================================================================
  // Delivery agent
  // =====================================================================

  myTasks(token: string): TaskView[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requireRole(user, 'AGENT', 'VENDOR');
      return db.tasks
        .filter((t) => t.assigneeId === user.id)
        .map((t) => this.taskView(db, t))
        .sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt));
    });
  }

  private taskView(db: Db, t: PickupDeliveryTask): TaskView {
    const job = db.jobs.find((j) => j.id === t.jobId)!;
    const customer = db.users.find((u) => u.id === job.customerId);
    return {
      task: stripOtp(t),
      jobRef: job.ref,
      jobStatus: job.status,
      device: this.deviceName(db, job),
      customerName: customer?.name ?? '—',
      customerPhone: customer?.phone ?? '',
      area: this.lookup(db, 'areas', t.address.area),
    };
  }

  /** All pickup/delivery tasks for operations. */
  allTasks(token: string): TaskView[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'deliveries.manage');
      return db.tasks
        .map((t) => this.taskView(db, t))
        .sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt));
    });
  }

  // =====================================================================
  // Notifications
  // =====================================================================

  notifications(token: string): Notification[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      return db.notifications
        .filter((n) => n.userId === user.id)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100);
    });
  }

  markNotificationsRead(token: string, ids?: Id[]): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      for (const n of db.notifications)
        if (n.userId === user.id && (!ids || ids.includes(n.id))) n.read = true;
    });
  }

  deliveryLog(token: string) {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'settings.manage');
      return db.deliveryLog.slice(-200).reverse();
    });
  }

  // =====================================================================
  // Administration
  // =====================================================================

  listVendors(token: string) {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'vendors.manage');
      return db.vendors.map((v) => {
        const u = db.users.find((x) => x.id === v.userId)!;
        return {
          ...v,
          // Payout details are masked even for admins; full IBAN is only needed by finance at payout time.
          payout: v.payout
            ? {
                ...v.payout,
                iban: `${v.payout.iban.slice(0, 4)}••••••••••••••••${v.payout.iban.slice(-4)}`,
              }
            : undefined,
          email: u.email,
          phone: u.phone,
          accountStatus: u.status,
          createdAt: u.createdAt,
          public: this.vendorPublic(db, v.userId)!,
          activeJobs: db.jobs.filter(
            (j) => j.vendorId === v.userId && ACTIVE_STATUSES.includes(j.status),
          ).length,
        };
      });
    });
  }

  setVendorStatus(token: string, vendorId: Id, status: VendorStatus, reason = ''): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'vendors.manage');
      const v = db.vendors.find((x) => x.userId === vendorId);
      if (!v) throw new ApiError('NOT_FOUND', 'Vendor not found.');
      const allowed: Record<VendorStatus, VendorStatus[]> = {
        PENDING: ['APPROVED', 'REJECTED'],
        APPROVED: ['SUSPENDED'],
        SUSPENDED: ['APPROVED'],
        REJECTED: ['APPROVED'],
      };
      if (!allowed[v.status].includes(status))
        throw new ApiError(
          'CONFLICT',
          `A ${v.status.toLowerCase()} vendor cannot become ${status.toLowerCase()}.`,
        );
      if ((status === 'REJECTED' || status === 'SUSPENDED') && reason.trim().length < 3) {
        throw new ApiError('VALIDATION', 'Give a reason; the vendor will see it.');
      }
      v.status = status;
      v.statusReason = reason.trim() || undefined;
      if (status === 'APPROVED' && !v.approvedAt) v.approvedAt = this.now();
      const messages: Record<VendorStatus, string> = {
        APPROVED: 'Your shop is approved. You can now accept repair jobs.',
        REJECTED: `Your application was not approved: ${reason}`,
        SUSPENDED: `Your account is suspended: ${reason}`,
        PENDING: '',
      };
      this.notify(db, vendorId, `Vendor account ${status.toLowerCase()}`, messages[status]);
      this.audit(db, user, `vendor.${status.toLowerCase()}`, 'vendor', vendorId, reason);
    });
  }

  listUsers(token: string, role: Role | 'STAFF_AND_AGENTS') {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, role === 'CUSTOMER' ? 'customers.manage' : 'staff.manage');
      const roles: Role[] =
        role === 'STAFF_AND_AGENTS' ? ['SUPER_ADMIN', 'STAFF', 'AGENT'] : [role];
      return db.users
        .filter((u) => roles.includes(u.role) && u.status !== 'DELETED')
        .map((u) => ({
          ...toPublic(u),
          jobs: db.jobs.filter((j) => j.customerId === u.id).length,
          activeTasks: db.tasks.filter(
            (t) => t.assigneeId === u.id && ['SCHEDULED', 'IN_PROGRESS'].includes(t.status),
          ).length,
        }));
    });
  }

  setUserStatus(token: string, userId: Id, status: 'ACTIVE' | 'SUSPENDED'): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      const target = db.users.find((u) => u.id === userId);
      if (!target || target.status === 'DELETED')
        throw new ApiError('NOT_FOUND', 'User not found.');
      this.requirePerm(user, target.role === 'CUSTOMER' ? 'customers.manage' : 'staff.manage');
      if (target.role === 'SUPER_ADMIN' || target.id === user.id)
        throw new ApiError('FORBIDDEN', 'You cannot change this account.');
      target.status = status;
      if (status === 'SUSPENDED') db.sessions = db.sessions.filter((s) => s.userId !== userId);
      this.audit(db, user, `user.${status.toLowerCase()}`, 'user', userId);
    });
  }

  createStaff(token: string, input: unknown): PublicUser {
    const data = parse(staffSchema, input);
    return this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'staff.manage');
      // Staff can never grant permissions they don't hold themselves.
      if (
        user.role !== 'SUPER_ADMIN' &&
        data.permissions.some((p) => !user.permissions.includes(p))
      ) {
        throw new ApiError('FORBIDDEN', 'You cannot grant permissions you do not have.');
      }
      const created = this.createUser(db, data.role, data);
      created.permissions = data.role === 'STAFF' ? data.permissions : [];
      created.phoneVerified = true;
      this.audit(
        db,
        user,
        'staff.created',
        'user',
        created.id,
        `${data.role}: ${data.permissions.join(', ')}`,
      );
      return toPublic(created);
    });
  }

  setPermissions(token: string, userId: Id, permissions: Permission[]): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'staff.manage');
      const target = db.users.find((u) => u.id === userId);
      if (!target || target.role !== 'STAFF')
        throw new ApiError('NOT_FOUND', 'Staff member not found.');
      if (
        user.role !== 'SUPER_ADMIN' &&
        (target.id === user.id || permissions.some((p) => !user.permissions.includes(p)))
      ) {
        throw new ApiError('FORBIDDEN', 'You cannot grant permissions you do not have.');
      }
      target.permissions = parse(staffSchema.shape.permissions, permissions);
      this.audit(db, user, 'staff.permissions', 'user', userId, permissions.join(', '));
    });
  }

  moderateReview(token: string, reviewId: Id, status: Review['status'], note: string): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'reviews.moderate');
      const r = db.reviews.find((x) => x.id === reviewId);
      if (!r) throw new ApiError('NOT_FOUND', 'Review not found.');
      if (status === 'HIDDEN' && note.trim().length < 3)
        throw new ApiError('VALIDATION', 'Record which policy rule applies.');
      r.status = status;
      r.moderationNote = note.trim() || undefined;
      this.audit(db, user, `review.${status.toLowerCase()}`, 'review', r.id, note);
    });
  }

  allReviews(token: string) {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'reviews.moderate');
      return db.reviews
        .map((r) => ({
          ...r,
          jobRef: db.jobs.find((j) => j.id === r.jobId)?.ref ?? '—',
          shopName: db.vendors.find((v) => v.userId === r.vendorId)?.shopName ?? '—',
          customerName: db.users.find((u) => u.id === r.customerId)?.name ?? '—',
        }))
        .sort((a, b) => b.at.localeCompare(a.at));
    });
  }

  settings(token: string): SystemSettings {
    return this.read((db) => {
      this.auth(db, token);
      return db.settings;
    });
  }

  updateSettings(token: string, input: unknown): SystemSettings {
    const data = parse(settingsSchema, input);
    return this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'settings.manage');
      if (data.enabledPaymentMethods.includes('ONLINE') && !db.settings.onlineGateway.configured) {
        throw new ApiError(
          'UNAVAILABLE',
          'Configure a payment gateway before enabling online payments.',
        );
      }
      const changed = Object.keys(data).filter(
        (k) =>
          JSON.stringify((db.settings as unknown as Record<string, unknown>)[k]) !==
          JSON.stringify((data as Record<string, unknown>)[k]),
      );
      db.settings = { ...db.settings, ...data };
      this.audit(db, user, 'settings.updated', 'settings', 'system', changed.join(', '));
      return db.settings;
    });
  }

  upsertCatalog(
    token: string,
    table: 'brands' | 'categories' | 'areas' | 'models',
    item: Record<string, unknown>,
  ): void {
    this.tx((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'catalog.manage');
      const name = parse(z.string().trim().min(2, 'Enter a name.').max(60), item['name']);
      const list = db[table] as unknown as Record<string, unknown>[];
      const existing = item['id'] ? list.find((x) => x['id'] === item['id']) : undefined;
      if (
        list.some(
          (x) =>
            String(x['name']).toLowerCase() === name.toLowerCase() &&
            x !== existing &&
            (table !== 'models' || x['brandId'] === item['brandId']),
        )
      ) {
        throw new ApiError('CONFLICT', `"${name}" already exists.`);
      }
      const extra: Record<string, unknown> = {};
      if (table === 'categories') {
        extra['icon'] = String(item['icon'] ?? 'build');
        extra['fromPrice'] = parse(z.number().int().min(0).max(100_000), item['fromPrice'] ?? 0);
      }
      if (table === 'areas')
        extra['city'] = parse(z.string().trim().min(2).max(40), item['city'] ?? 'Lahore');
      if (table === 'models') {
        if (!db.brands.some((b) => b.id === item['brandId']))
          throw new ApiError('VALIDATION', 'Choose a brand.');
        extra['brandId'] = item['brandId'];
      }
      if (table !== 'models') extra['active'] = item['active'] !== false;
      if (existing) Object.assign(existing, { name, ...extra });
      else list.push({ id: this.nextId(db, table.slice(0, 3)), name, ...extra });
      this.audit(
        db,
        user,
        existing ? 'catalog.updated' : 'catalog.created',
        table,
        String(existing?.['id'] ?? 'new'),
        name,
      );
    });
  }

  /** Full catalogue including inactive entries, for the catalogue admin page. */
  adminCatalog(token: string) {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'catalog.manage');
      return { brands: db.brands, models: db.models, categories: db.categories, areas: db.areas };
    });
  }

  auditLog(token: string, search = ''): (AuditLog & { actorName: string })[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'audit.view');
      const s = search.trim().toLowerCase();
      return db.audit
        .map((a) => ({
          ...a,
          actorName:
            a.actorId === 'system'
              ? 'System'
              : (db.users.find((u) => u.id === a.actorId)?.name ?? a.actorId),
        }))
        .filter(
          (a) =>
            !s ||
            [a.action, a.entity, a.entityId, a.detail, a.actorName].some((v) =>
              v?.toLowerCase().includes(s),
            ),
        )
        .reverse()
        .slice(0, 500);
    });
  }

  reportData(token: string): ReportData {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'reports.view');
      const pick = (rows: { id: Id; name: string }[]) => rows.map(({ id, name }) => ({ id, name }));
      return {
        // Addresses and descriptions are not needed for reporting.
        jobs: db.jobs.map((j) => ({
          ...j,
          pickupAddress: { line1: '', area: j.pickupAddress.area, city: j.pickupAddress.city },
          deliveryAddress: { line1: '', area: j.deliveryAddress.area, city: '' },
          description: '',
        })),
        history: db.history,
        quotations: db.quotations,
        transactions: db.transactions,
        settlements: db.settlements,
        reviews: db.reviews,
        complaints: db.complaints.map((c) => ({ ...c, messages: [] })),
        vendors: db.vendors.map((v) => ({
          id: v.userId,
          shopName: v.shopName,
          status: v.status,
          createdAt: v.termsAcceptedAt,
        })),
        customers: db.users
          .filter((u) => u.role === 'CUSTOMER')
          .map((u) => ({ id: u.id, createdAt: u.createdAt })),
        assignments: db.assignments,
        brands: pick(db.brands),
        models: pick(db.models),
        categories: pick(db.categories),
        areas: pick(db.areas),
        now: this.now(),
      };
    });
  }

  /** Approved vendors eligible for a job, best match first, for the assignment dialog. */
  candidateVendors(token: string, jobId: Id) {
    return this.read((db) => {
      const user = this.auth(db, token);
      this.requirePerm(user, 'jobs.assign');
      const job = this.job(db, jobId);
      return db.vendors
        .filter((v) => v.status === 'APPROVED')
        .map((v) => ({
          vendorId: v.userId,
          shopName: v.shopName,
          eligible: this.eligible(db, v, job),
          available: v.available,
          coversArea: v.serviceAreas.includes(job.pickupAddress.area),
          specialist: v.specialties.includes(job.categoryId),
          brand: v.brands.includes(job.brandId),
          activeJobs: db.jobs.filter(
            (j) => j.vendorId === v.userId && ACTIVE_STATUSES.includes(j.status),
          ).length,
          rating: this.vendorPublic(db, v.userId)?.rating ?? null,
        }))
        .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.activeJobs - b.activeJobs);
    });
  }

  agents(token: string): { id: Id; name: string }[] {
    return this.read((db) => {
      const user = this.auth(db, token);
      if (!this.isAdmin(user) && user.role !== 'VENDOR')
        throw new ApiError('FORBIDDEN', 'Not allowed.');
      return db.users
        .filter((u) => u.role === 'AGENT' && u.status === 'ACTIVE')
        .map((u) => ({ id: u.id, name: u.name }));
    });
  }

  /** Commission preview so the quotation form shows the vendor's net. */
  commissionPreview(token: string, base: number): number {
    return this.read((db) => {
      this.auth(db, token);
      return commissionFor(base, db.settings.commissionPct, db.settings.commissionFixed);
    });
  }
}
