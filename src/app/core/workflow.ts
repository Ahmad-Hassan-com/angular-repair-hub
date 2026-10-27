import { JobStatus } from './models';

/** Who may fire a transition. ADMIN means a super admin or staff holding `jobs.assign`. */
export type Actor = 'CUSTOMER' | 'VENDOR' | 'AGENT' | 'ADMIN' | 'SYSTEM';

export interface Transition {
  to: JobStatus;
  actors: Actor[];
  /** Button label for the action. */
  label: string;
  /**
   * Plain transitions can be fired through `advance()`. The rest carry side effects
   * (OTP checks, quotations, payments...) and only happen through their own endpoint.
   */
  plain: boolean;
  /** Ask the user for a reason or note. */
  needsNote?: boolean;
}

const t = (to: JobStatus, actors: Actor[], label: string, plain = true, needsNote = false) => ({
  to,
  actors,
  label,
  plain,
  needsNote,
});

const pickupCancellable = t('CANCELLED', ['CUSTOMER', 'ADMIN'], 'Cancel request', false, true);

/**
 * The single source of truth for the job lifecycle. The backend refuses any status
 * change that is not listed here, so steps cannot be skipped.
 */
export const TRANSITIONS: Record<JobStatus, Transition[]> = {
  SUBMITTED: [
    t('AWAITING_VENDOR', ['SYSTEM', 'ADMIN'], 'Publish / assign', false),
    pickupCancellable,
  ],
  AWAITING_VENDOR: [
    t('VENDOR_ACCEPTED', ['VENDOR'], 'Accept job', false),
    t('SUBMITTED', ['VENDOR', 'SYSTEM', 'ADMIN'], 'Decline', false),
    pickupCancellable,
  ],
  VENDOR_ACCEPTED: [
    t('PICKUP_SCHEDULED', ['VENDOR', 'ADMIN'], 'Schedule pickup', false),
    t('SUBMITTED', ['ADMIN'], 'Reassign', false),
    pickupCancellable,
  ],
  PICKUP_SCHEDULED: [
    t('PICKUP_IN_PROGRESS', ['VENDOR', 'AGENT'], 'Start pickup'),
    t('PICKUP_SCHEDULED', ['VENDOR', 'AGENT', 'ADMIN'], 'Reschedule', false),
    pickupCancellable,
  ],
  PICKUP_IN_PROGRESS: [
    t('PHONE_COLLECTED', ['VENDOR', 'AGENT'], 'Confirm collection', false),
    t('PICKUP_FAILED', ['VENDOR', 'AGENT'], 'Pickup failed', true, true),
    t('CUSTOMER_UNAVAILABLE', ['VENDOR', 'AGENT'], 'Customer unavailable', true, true),
  ],
  PICKUP_FAILED: [
    t('PICKUP_SCHEDULED', ['VENDOR', 'AGENT', 'ADMIN'], 'Reschedule pickup', false),
    t('CANCELLED', ['ADMIN', 'CUSTOMER'], 'Cancel request', false, true),
  ],
  CUSTOMER_UNAVAILABLE: [
    // Before collection this re-books the pickup; after it, the delivery.
    t('PICKUP_SCHEDULED', ['VENDOR', 'AGENT', 'ADMIN'], 'Reschedule pickup', false),
    t('READY_FOR_DELIVERY', ['VENDOR', 'AGENT', 'ADMIN'], 'Reschedule delivery', false),
    t('CANCELLED', ['ADMIN'], 'Cancel request', false, true),
  ],
  PHONE_COLLECTED: [t('RECEIVED_AT_SHOP', ['VENDOR'], 'Received at shop')],
  RECEIVED_AT_SHOP: [t('INSPECTION_IN_PROGRESS', ['VENDOR'], 'Start inspection')],
  INSPECTION_IN_PROGRESS: [
    t('QUOTATION_SUBMITTED', ['VENDOR'], 'Submit quotation', false),
    t('UNREPAIRABLE', ['VENDOR'], 'Mark unrepairable', false, true),
  ],
  QUOTATION_SUBMITTED: [t('AWAITING_APPROVAL', ['SYSTEM'], 'Request approval', false)],
  AWAITING_APPROVAL: [
    t('QUOTATION_APPROVED', ['CUSTOMER'], 'Approve quotation', false),
    t('QUOTATION_REJECTED', ['CUSTOMER'], 'Reject quotation', false, true),
  ],
  QUOTATION_APPROVED: [t('REPAIR_IN_PROGRESS', ['VENDOR'], 'Start repair')],
  REPAIR_IN_PROGRESS: [
    t('WAITING_FOR_PARTS', ['VENDOR'], 'Waiting for parts', true, true),
    t('QUOTATION_SUBMITTED', ['VENDOR'], 'Revise quotation', false),
    t('REPAIR_COMPLETED', ['VENDOR'], 'Repair completed'),
  ],
  WAITING_FOR_PARTS: [
    t('REPAIR_IN_PROGRESS', ['VENDOR'], 'Parts arrived, resume'),
    t('QUOTATION_SUBMITTED', ['VENDOR'], 'Revise quotation', false),
  ],
  REPAIR_COMPLETED: [t('QUALITY_CHECKED', ['VENDOR'], 'Quality check passed')],
  QUALITY_CHECKED: [t('READY_FOR_DELIVERY', ['VENDOR'], 'Ready for delivery', false)],
  QUOTATION_REJECTED: [t('READY_FOR_DELIVERY', ['VENDOR'], 'Return phone to customer', false)],
  UNREPAIRABLE: [t('READY_FOR_DELIVERY', ['VENDOR'], 'Return phone to customer', false)],
  READY_FOR_DELIVERY: [t('OUT_FOR_DELIVERY', ['VENDOR', 'AGENT'], 'Out for delivery')],
  OUT_FOR_DELIVERY: [
    t('DELIVERED', ['VENDOR', 'AGENT'], 'Confirm delivery', false),
    t('CUSTOMER_UNAVAILABLE', ['VENDOR', 'AGENT'], 'Customer unavailable', true, true),
  ],
  DELIVERED: [
    t('PAID', ['SYSTEM'], 'Payment completed', false),
    t('RETURNED_WITHOUT_REPAIR', ['SYSTEM'], 'Returned without repair', false),
    t('CLOSED', ['SYSTEM', 'ADMIN'], 'Close job', false),
    t('DISPUTED', ['CUSTOMER', 'ADMIN'], 'Raise dispute', false, true),
  ],
  RETURNED_WITHOUT_REPAIR: [
    t('PAID', ['SYSTEM'], 'Payment completed', false),
    t('CLOSED', ['SYSTEM', 'ADMIN'], 'Close job', false),
  ],
  PAID: [
    t('CLOSED', ['VENDOR', 'ADMIN'], 'Close job', false),
    t('DISPUTED', ['CUSTOMER', 'ADMIN'], 'Raise dispute', false, true),
  ],
  CLOSED: [t('DISPUTED', ['CUSTOMER', 'ADMIN'], 'Raise dispute', false, true)],
  DISPUTED: [
    t('CLOSED', ['ADMIN'], 'Resolve and close', false, true),
    t('REFUNDED', ['SYSTEM'], 'Refund issued', false),
  ],
  REFUNDED: [t('CLOSED', ['ADMIN', 'SYSTEM'], 'Close job', false)],
  CANCELLED: [],
};

export function canTransition(from: JobStatus, to: JobStatus, actor: Actor): boolean {
  return TRANSITIONS[from].some((tr) => tr.to === to && tr.actors.includes(actor));
}

export function findTransition(from: JobStatus, to: JobStatus): Transition | undefined {
  return TRANSITIONS[from].find((tr) => tr.to === to);
}

/** Plain transitions the actor may fire from `from`, for rendering action buttons. */
export function plainActions(from: JobStatus, actor: Actor): Transition[] {
  return TRANSITIONS[from].filter((tr) => tr.plain && tr.actors.includes(actor));
}

export type Tone = 'neutral' | 'info' | 'progress' | 'warning' | 'success' | 'danger';

interface StatusMeta {
  label: string;
  tone: Tone;
  icon: string;
  /** Step on the customer-facing progress bar (0-6). */
  stage: number;
}

export const STATUS_META: Record<JobStatus, StatusMeta> = {
  SUBMITTED: { label: 'Request submitted', tone: 'neutral', icon: 'send', stage: 0 },
  AWAITING_VENDOR: { label: 'Awaiting vendor', tone: 'info', icon: 'hourglass_top', stage: 0 },
  VENDOR_ACCEPTED: { label: 'Vendor accepted', tone: 'info', icon: 'handshake', stage: 1 },
  PICKUP_SCHEDULED: { label: 'Pickup scheduled', tone: 'info', icon: 'event', stage: 1 },
  PICKUP_IN_PROGRESS: {
    label: 'Pickup in progress',
    tone: 'progress',
    icon: 'two_wheeler',
    stage: 1,
  },
  PHONE_COLLECTED: { label: 'Phone collected', tone: 'progress', icon: 'inventory', stage: 2 },
  RECEIVED_AT_SHOP: { label: 'Received at shop', tone: 'progress', icon: 'store', stage: 2 },
  INSPECTION_IN_PROGRESS: { label: 'Inspection', tone: 'progress', icon: 'search', stage: 2 },
  QUOTATION_SUBMITTED: {
    label: 'Quotation submitted',
    tone: 'warning',
    icon: 'request_quote',
    stage: 3,
  },
  AWAITING_APPROVAL: {
    label: 'Awaiting your approval',
    tone: 'warning',
    icon: 'pending_actions',
    stage: 3,
  },
  QUOTATION_APPROVED: { label: 'Quotation approved', tone: 'progress', icon: 'thumb_up', stage: 3 },
  REPAIR_IN_PROGRESS: { label: 'Repair in progress', tone: 'progress', icon: 'build', stage: 4 },
  WAITING_FOR_PARTS: { label: 'Waiting for parts', tone: 'warning', icon: 'inventory_2', stage: 4 },
  REPAIR_COMPLETED: { label: 'Repair completed', tone: 'progress', icon: 'task_alt', stage: 4 },
  QUALITY_CHECKED: { label: 'Quality checked', tone: 'progress', icon: 'verified', stage: 4 },
  READY_FOR_DELIVERY: {
    label: 'Ready for delivery',
    tone: 'info',
    icon: 'local_shipping',
    stage: 5,
  },
  OUT_FOR_DELIVERY: {
    label: 'Out for delivery',
    tone: 'progress',
    icon: 'delivery_dining',
    stage: 5,
  },
  DELIVERED: { label: 'Delivered', tone: 'success', icon: 'home', stage: 6 },
  PAID: { label: 'Paid', tone: 'success', icon: 'payments', stage: 6 },
  CLOSED: { label: 'Closed', tone: 'success', icon: 'check_circle', stage: 6 },
  CANCELLED: { label: 'Cancelled', tone: 'danger', icon: 'cancel', stage: 0 },
  PICKUP_FAILED: { label: 'Pickup failed', tone: 'danger', icon: 'error', stage: 1 },
  CUSTOMER_UNAVAILABLE: {
    label: 'Customer unavailable',
    tone: 'danger',
    icon: 'person_off',
    stage: 1,
  },
  QUOTATION_REJECTED: { label: 'Repair rejected', tone: 'danger', icon: 'thumb_down', stage: 3 },
  UNREPAIRABLE: { label: 'Unrepairable', tone: 'danger', icon: 'heart_broken', stage: 3 },
  RETURNED_WITHOUT_REPAIR: {
    label: 'Returned without repair',
    tone: 'neutral',
    icon: 'undo',
    stage: 6,
  },
  DISPUTED: { label: 'Disputed', tone: 'danger', icon: 'gavel', stage: 6 },
  REFUNDED: { label: 'Refunded', tone: 'neutral', icon: 'currency_exchange', stage: 6 },
};

export const STAGES = [
  'Requested',
  'Pickup',
  'Inspection',
  'Quotation',
  'Repair',
  'Delivery',
  'Done',
];

export const ALL_STATUSES = Object.keys(STATUS_META) as JobStatus[];

/** Jobs that still need work from someone. */
export const ACTIVE_STATUSES: JobStatus[] = ALL_STATUSES.filter(
  (s) => !['CLOSED', 'CANCELLED', 'REFUNDED', 'PAID', 'RETURNED_WITHOUT_REPAIR'].includes(s),
);

/** The phone is with the vendor (or on its way back): repair work states. */
export const REPAIR_STATUSES: JobStatus[] = [
  'PHONE_COLLECTED',
  'RECEIVED_AT_SHOP',
  'INSPECTION_IN_PROGRESS',
  'QUOTATION_SUBMITTED',
  'AWAITING_APPROVAL',
  'QUOTATION_APPROVED',
  'REPAIR_IN_PROGRESS',
  'WAITING_FOR_PARTS',
  'REPAIR_COMPLETED',
  'QUALITY_CHECKED',
];

/** Final states where the money position of a job is settled. */
export const FINAL_STATUSES: JobStatus[] = [
  'PAID',
  'CLOSED',
  'REFUNDED',
  'RETURNED_WITHOUT_REPAIR',
];

/** Vendor work is done once the phone is back with the customer. */
export const COMPLETED_STATUSES: JobStatus[] = [
  'DELIVERED',
  'PAID',
  'CLOSED',
  'RETURNED_WITHOUT_REPAIR',
  'DISPUTED',
  'REFUNDED',
];
