import { z } from 'zod';
import { PERMISSIONS, TIME_WINDOWS } from './models';

// Request schemas. The backend parses every input with these before touching data;
// the forms reuse the same rules so the user sees the error before submitting.

/** Pakistani mobile numbers: 03XXXXXXXXX, 3XXXXXXXXX or +923XXXXXXXXX. */
export const PK_MOBILE = /^(?:\+92|0)?3\d{9}$/;

export function normalisePhone(value: string): string {
  const digits = value.replace(/[\s-]/g, '');
  const m = digits.match(/^(?:\+92|0)?(3\d{9})$/);
  return m ? `+92${m[1]}` : digits;
}

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => PK_MOBILE.test(v), 'Enter a Pakistani mobile number, e.g. 0300 1234567.')
  .transform(normalisePhone);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(120);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Use letters and numbers.');

export const addressSchema = z.object({
  line1: trimmed(5, 160, 'Street address'),
  area: z.string().min(1, 'Choose a service area.'),
  city: trimmed(2, 60, 'City'),
  landmark: z.string().trim().max(120).optional(),
});

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const timeWindow = z.enum(TIME_WINDOWS as [string, ...string[]]);

export const registerCustomerSchema = z.object({
  name: trimmed(2, 80, 'Full name'),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

export const registerVendorSchema = z.object({
  ownerName: trimmed(2, 80, "Owner's name"),
  shopName: trimmed(2, 80, 'Shop name'),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  address: addressSchema,
  serviceAreas: z.array(z.string()).min(1, 'Choose at least one service area.'),
  specialties: z.array(z.string()).min(1, 'Choose at least one repair specialty.'),
  brands: z.array(z.string()).min(1, 'Choose at least one phone brand.'),
  documentFileIds: z.array(z.string()).max(3).default([]),
  payout: z
    .object({
      bankName: trimmed(2, 60, 'Bank name'),
      accountTitle: trimmed(2, 80, 'Account title'),
      iban: z
        .string()
        .trim()
        .toUpperCase()
        .regex(
          /^PK\d{2}[A-Z]{4}\d{16}$/,
          'Enter a 24-character Pakistani IBAN, e.g. PK36SCBL0000001123456702.',
        ),
    })
    .optional(),
  acceptTerms: z.literal(true, 'You must accept the platform terms.'),
});

export const repairRequestSchema = z.object({
  brandId: z.string().min(1, 'Choose a brand.'),
  modelId: z.string().min(1, 'Choose a model.'),
  categoryId: z.string().min(1, 'Choose a problem category.'),
  description: trimmed(10, 1000, 'Problem description'),
  photoIds: z.array(z.string()).max(4, 'Upload up to 4 photos.').default([]),
  pickupAddress: addressSchema,
  deliveryAddress: addressSchema,
  preferredPickupDate: dateString,
  preferredPickupWindow: timeWindow,
  diagnosticConsent: z.boolean(),
});

export const scheduleSchema = z.object({
  date: dateString,
  window: timeWindow,
  fee: z.number().int().min(0).max(5000),
  assigneeId: z.string().optional(),
  note: z.string().trim().max(300).optional(),
});

export const conditionSchema = z.object({
  physicalCondition: z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR']),
  existingDamage: z.string().trim().max(500).default(''),
  accessories: z.array(z.string().trim().max(40)).max(10).default([]),
  imei: z
    .string()
    .trim()
    .regex(/^\d{15}$/, 'IMEI must be 15 digits.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  powersOn: z.boolean(),
  photoIds: z.array(z.string()).max(4).default([]),
});

export const quotationItemSchema = z.object({
  type: z.enum(['PART', 'LABOR', 'DIAGNOSTIC', 'DELIVERY', 'OTHER']),
  description: trimmed(2, 120, 'Item description'),
  quantity: z.number().int().min(1).max(99),
  unitPrice: z.number().int().min(0).max(1_000_000),
});

export const quotationSchema = z.object({
  findings: trimmed(5, 1000, 'Inspection findings'),
  proposedRepair: trimmed(5, 500, 'Proposed repair'),
  items: z.array(quotationItemSchema).min(1, 'Add at least one line item.').max(20),
  discount: z.number().int().min(0).default(0),
  estimatedCompletion: z.string().min(1, 'Choose an estimated completion date.'),
  warrantyDays: z.number().int().min(0).max(365),
  notes: z.string().trim().max(500).optional(),
});

export const paymentSchema = z.object({
  method: z.enum(['CASH_ON_DELIVERY', 'CASH_TO_VENDOR', 'BANK_TRANSFER', 'ONLINE']),
  amount: z.number().int().min(1, 'Amount must be at least Rs 1.'),
  reference: z.string().trim().max(60).optional(),
  idempotencyKey: z.string().min(8),
});

export const refundSchema = z.object({
  amount: z.number().int().min(1),
  reason: trimmed(5, 300, 'Reason'),
  collector: z.enum(['PLATFORM', 'VENDOR']),
  idempotencyKey: z.string().min(8),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(800).default(''),
});

export const complaintSchema = z.object({
  jobId: z.string().optional(),
  subject: trimmed(5, 120, 'Subject'),
  body: trimmed(10, 2000, 'Message'),
  isDispute: z.boolean().default(false),
});

export const staffSchema = z.object({
  role: z.enum(['STAFF', 'AGENT']),
  name: trimmed(2, 80, 'Name'),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});

export const settingsSchema = z.object({
  assignmentMode: z.enum(['FIRST_ACCEPT', 'ADMIN_ASSIGN']),
  acceptanceTimeoutHours: z.number().int().min(1).max(72),
  commissionPct: z.number().min(0).max(50),
  commissionFixed: z.number().int().min(0).max(10_000),
  taxRatePct: z.number().min(0).max(30),
  defaultPickupFee: z.number().int().min(0).max(5000),
  defaultDeliveryFee: z.number().int().min(0).max(5000),
  diagnosticFee: z.number().int().min(0).max(10_000),
  otpTtlMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  otpMaxAttempts: z.number().int().min(3).max(10),
  enabledPaymentMethods: z
    .array(z.enum(['CASH_ON_DELIVERY', 'CASH_TO_VENDOR', 'BANK_TRANSFER', 'ONLINE']))
    .min(1),
  reviewPolicy: z.string().trim().max(1000),
});

/** First readable message from a failed parse. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? 'Invalid input.';
}
