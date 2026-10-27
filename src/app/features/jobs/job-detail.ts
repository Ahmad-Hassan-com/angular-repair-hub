import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { Backend, ConditionInput, QuotationInput, ScheduleInput } from '../../core/backend';
import { quoteTotals } from '../../core/finance';
import { JobStatus, PaymentMethod, RepairQuotation, RepairWorkLog } from '../../core/models';
import { METHOD_LABEL } from '../../core/reports';
import { Session } from '../../core/session';
import { Actor, plainActions, STAGES, STATUS_META, Transition } from '../../core/workflow';
import { Dialogs } from '../../shared/dialogs';
import { FileThumb, PhotoUpload } from '../../shared/files';
import {
  EmptyState,
  idempotencyKey,
  Loading,
  PkDatePipe,
  PkrPipe,
  StatusBadge,
  Toast,
} from '../../shared/ui';
import { AssignDialog } from './assign-dialog';
import { Financials } from './financials';
import { HandoverForm, PaymentForm, ScheduleForm } from './forms';
import { QuotationForm } from './quotation-form';
import { Timeline } from './timeline';

const COURIER_STEPS: JobStatus[] = [
  'PICKUP_IN_PROGRESS',
  'OUT_FOR_DELIVERY',
  'PICKUP_FAILED',
  'CUSTOMER_UNAVAILABLE',
];
const PRE_COLLECTION: JobStatus[] = [
  'SUBMITTED',
  'AWAITING_VENDOR',
  'VENDOR_ACCEPTED',
  'PICKUP_SCHEDULED',
  'PICKUP_FAILED',
  'CUSTOMER_UNAVAILABLE',
];
const PAYABLE: JobStatus[] = [
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURNED_WITHOUT_REPAIR',
  'DISPUTED',
];

/** One page for every role. The backend decides what each caller may see and do; the UI mirrors it. */
@Component({
  selector: 'app-job-detail',
  imports: [
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTooltipModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    StatusBadge,
    PkrPipe,
    PkDatePipe,
    Loading,
    EmptyState,
    Timeline,
    Financials,
    QuotationForm,
    ScheduleForm,
    HandoverForm,
    PaymentForm,
    PhotoUpload,
    FileThumb,
  ],
  templateUrl: './job-detail.html',
  styleUrl: './job-detail.scss',
})
export class JobDetail {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly dialogs = inject(Dialogs);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);
  readonly id = input.required<string>();

  protected readonly job = resource({
    params: () => ({ id: this.id(), rev: this.api.revision() }),
    loader: ({ params }) => this.api.query((b, t) => b.getJob(t, params.id)),
  });
  protected readonly settings = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.settings(t)),
  });
  protected readonly agents = resource({
    params: () => ({ role: this.session.role() }),
    loader: ({ params }) =>
      params.role === 'VENDOR' || params.role === 'SUPER_ADMIN' || params.role === 'STAFF'
        ? this.api.query((b, t) => b.agents(t))
        : Promise.resolve([]),
  });

  protected readonly busy = signal(false);
  protected readonly handoverCode = signal<{
    code: string;
    kind: string;
    expiresAt: string;
  } | null>(null);
  protected readonly reschedule = signal(false);
  protected readonly revising = signal(false);
  protected readonly reviewRating = signal(0);
  protected reviewComment = '';
  protected readonly logPhotos = signal<string[]>([]);
  protected logNote = '';
  protected logKind: RepairWorkLog['kind'] = 'NOTE';
  protected part = { partName: '', partNumber: '', quantity: 1, unitCost: 0 };

  protected readonly stages = STAGES;
  protected readonly methodLabel = METHOD_LABEL;
  protected readonly meta = computed(() =>
    this.job.value() ? STATUS_META[this.job.value()!.job.status] : null,
  );

  protected readonly role = computed(() => this.session.role());
  protected readonly isCustomer = computed(() => this.role() === 'CUSTOMER');
  protected readonly isVendor = computed(() => this.role() === 'VENDOR');
  protected readonly isAgent = computed(() => this.role() === 'AGENT');
  protected readonly isAdmin = computed(
    () => this.role() === 'SUPER_ADMIN' || this.role() === 'STAFF',
  );
  protected readonly audience = computed(() => (this.isCustomer() ? 'customer' : 'staff'));
  protected readonly listLink = computed(() => {
    const role = this.role();
    return role === 'CUSTOMER'
      ? '/customer'
      : role === 'VENDOR'
        ? '/vendor/jobs'
        : role === 'AGENT'
          ? '/agent'
          : '/admin/jobs';
  });

  protected readonly status = computed(() => this.job.value()?.job.status);
  protected readonly actor = computed<Actor | null>(() => {
    const v = this.job.value();
    if (!v || v.access !== 'FULL') return null;
    if (this.isCustomer()) return 'CUSTOMER';
    if (this.isVendor()) return 'VENDOR';
    if (this.isAgent()) return 'AGENT';
    return this.session.can('jobs.assign') ? 'ADMIN' : null;
  });

  /** The pickup or delivery task currently assigned to the signed-in user. */
  protected readonly myTask = computed(() => {
    const v = this.job.value();
    const me = this.session.user()?.id;
    return v?.tasks.find(
      (t) => t.assigneeId === me && (t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS'),
    );
  });
  protected readonly activeTask = computed(() =>
    this.job.value()?.tasks.find((t) => t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS'),
  );

  /** Simple next-step buttons; courier steps only for whoever is doing the visit. */
  protected readonly actions = computed<Transition[]>(() => {
    const s = this.status();
    const actor = this.actor();
    if (!s || !actor || actor === 'CUSTOMER') return [];
    return plainActions(s, actor).filter((t) =>
      COURIER_STEPS.includes(t.to) ? !!this.myTask() : actor === 'VENDOR',
    );
  });

  protected readonly collected = computed(() => !!this.job.value()?.job.collectedAt);
  protected readonly canSchedulePickup = computed(() => {
    const s = this.status();
    const allowed = this.isVendor() || (this.isAdmin() && this.session.can('deliveries.manage'));
    if (!s || !allowed || this.job.value()?.access !== 'FULL') return false;
    return (
      s === 'VENDOR_ACCEPTED' ||
      s === 'PICKUP_FAILED' ||
      (s === 'CUSTOMER_UNAVAILABLE' && !this.collected()) ||
      (s === 'PICKUP_SCHEDULED' && this.reschedule())
    );
  });
  protected readonly canScheduleDelivery = computed(() => {
    const s = this.status();
    const allowed = this.isVendor() || (this.isAdmin() && this.session.can('deliveries.manage'));
    if (!s || !allowed) return false;
    return (
      ['QUALITY_CHECKED', 'QUOTATION_REJECTED', 'UNREPAIRABLE'].includes(s) ||
      (s === 'CUSTOMER_UNAVAILABLE' && this.collected()) ||
      (s === 'READY_FOR_DELIVERY' && this.reschedule() && this.isVendor())
    );
  });
  protected readonly canQuote = computed(
    () => this.isVendor() && (this.status() === 'INSPECTION_IN_PROGRESS' || this.revising()),
  );
  protected readonly inRepair = computed(
    () =>
      this.isVendor() && ['REPAIR_IN_PROGRESS', 'WAITING_FOR_PARTS'].includes(this.status() ?? ''),
  );
  protected readonly inWorkshop = computed(
    () =>
      this.isVendor() &&
      this.collected() &&
      ![
        'DELIVERED',
        'PAID',
        'CLOSED',
        'RETURNED_WITHOUT_REPAIR',
        'DISPUTED',
        'REFUNDED',
        'OUT_FOR_DELIVERY',
      ].includes(this.status() ?? ''),
  );
  protected readonly canCustomerCancel = computed(
    () =>
      this.isCustomer() && !!this.settings.value()?.customerCancellable.includes(this.status()!),
  );
  protected readonly canAdminCancel = computed(
    () =>
      this.isAdmin() && this.session.can('jobs.cancel') && PRE_COLLECTION.includes(this.status()!),
  );
  protected readonly canAssign = computed(
    () =>
      this.isAdmin() &&
      this.session.can('jobs.assign') &&
      ['SUBMITTED', 'AWAITING_VENDOR', 'VENDOR_ACCEPTED'].includes(this.status()!),
  );
  protected readonly canDispute = computed(
    () => this.isCustomer() && ['DELIVERED', 'PAID', 'CLOSED'].includes(this.status()!),
  );
  protected readonly outstanding = computed(() => this.job.value()?.financials.outstanding ?? 0);
  protected readonly payable = computed(
    () => PAYABLE.includes(this.status()!) && this.outstanding() > 0,
  );
  protected readonly courierMethods = computed<PaymentMethod[]>(() => {
    const enabled = this.settings.value()?.enabledPaymentMethods ?? [];
    const options: PaymentMethod[] = this.isVendor()
      ? ['CASH_ON_DELIVERY', 'CASH_TO_VENDOR']
      : ['CASH_ON_DELIVERY'];
    return options.filter((m) => enabled.includes(m));
  });
  protected readonly pendingTransfers = computed(() =>
    (this.job.value()?.transactions ?? []).filter((t) => t.status === 'PENDING_VERIFICATION'),
  );
  protected readonly refundable = computed(() => {
    const f = this.job.value()?.financials;
    return f ? f.paid - f.refunded : 0;
  });
  protected readonly latestApproved = computed(() =>
    this.job.value()?.quotations.find((q) => q.status === 'APPROVED'),
  );
  protected readonly pendingQuote = computed(() =>
    this.job.value()?.quotations.find((q) => q.status === 'PENDING'),
  );

  protected totals(q: RepairQuotation) {
    return quoteTotals(q.items, q.discount, q.taxRatePct);
  }

  protected areaName(id: string): string {
    return this.job.value()?.area && this.job.value()?.job.pickupAddress.area === id
      ? this.job.value()!.area
      : '';
  }

  /** Runs a backend call with a busy state and a toast either way. */
  private async run(fn: (b: Backend, t: string) => unknown, ok: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await this.api.mutate(fn);
      this.toast.ok(ok);
      return true;
    } catch (e) {
      this.toast.error(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Marketplace ----------

  protected async accept(): Promise<void> {
    const v = this.job.value()!;
    if (
      await this.run(
        (b, t) => b.acceptJob(t, v.job.id, v.job.version),
        'Job accepted. Schedule the pickup next.',
      )
    ) {
      // The marketplace view was limited; reload with full access.
      this.job.reload();
    }
  }

  protected async decline(): Promise<void> {
    const reason = await this.dialogs.prompt(
      'Decline this job?',
      'Operations will offer it to another shop.',
      'Reason',
      'Decline',
      false,
    );
    if (reason === null) return;
    if (await this.run((b, t) => b.declineOffer(t, this.id(), reason), 'Offer declined.'))
      this.router.navigate(['/vendor/marketplace']);
  }

  // ---------- Plain transitions ----------

  protected async fire(tr: Transition): Promise<void> {
    let note = '';
    if (tr.needsNote) {
      const text = await this.dialogs.prompt(
        tr.label,
        'Add a short reason. The customer will see it.',
        'Reason',
        tr.label,
        true,
        tr.to === 'PICKUP_FAILED' || tr.to === 'CUSTOMER_UNAVAILABLE',
      );
      if (text === null) return;
      note = text;
    }
    const v = this.job.value()!;
    await this.run(
      (b, t) => b.advance(t, v.job.id, tr.to, note, [], v.job.version),
      `${tr.label}: done.`,
    );
  }

  // ---------- Pickup, workshop, delivery ----------

  protected async schedulePickup(input: ScheduleInput): Promise<void> {
    if (
      await this.run(
        (b, t) => b.schedulePickup(t, this.id(), input),
        'Pickup scheduled. The customer has been notified.',
      )
    )
      this.reschedule.set(false);
  }

  protected async scheduleDelivery(input: ScheduleInput): Promise<void> {
    if (await this.run((b, t) => b.scheduleDelivery(t, this.id(), input), 'Delivery scheduled.'))
      this.reschedule.set(false);
  }

  protected collect(e: { otp: string; condition: ConditionInput }): void {
    this.run(
      (b, t) => b.confirmCollection(t, this.id(), e.otp, e.condition),
      'Collection confirmed.',
    );
  }

  protected deliver(e: { otp: string; note: string; photoIds: string[] }): void {
    this.run(
      (b, t) => b.confirmDelivery(t, this.id(), e.otp, e.note, e.photoIds),
      'Delivery confirmed.',
    );
  }

  protected async submitQuote(input: QuotationInput): Promise<void> {
    if (
      await this.run(
        (b, t) => b.submitQuotation(t, this.id(), input),
        'Quotation sent. The customer has been asked to approve it.',
      )
    )
      this.revising.set(false);
  }

  protected async unrepairable(): Promise<void> {
    const findings = await this.dialogs.prompt(
      'Mark as unrepairable?',
      'The phone will be returned to the customer. Only a consented diagnostic fee is charged.',
      'What did you find?',
      'Mark unrepairable',
      true,
      true,
    );
    if (findings)
      this.run((b, t) => b.markUnrepairable(t, this.id(), findings), 'Marked as unrepairable.');
  }

  protected async addPart(): Promise<void> {
    const p = {
      ...this.part,
      quantity: Math.round(Number(this.part.quantity)),
      unitCost: Math.round(Number(this.part.unitCost)),
      partNumber: this.part.partNumber || undefined,
    };
    if (await this.run((b, t) => b.addPart(t, this.id(), p), 'Part recorded.'))
      this.part = { partName: '', partNumber: '', quantity: 1, unitCost: 0 };
  }

  protected async addLog(): Promise<void> {
    const kind = this.logKind;
    const note = this.logNote;
    const files = this.logPhotos();
    if (
      await this.run(
        (b, t) => b.addWorkLog(t, this.id(), kind, note, files),
        kind === 'DELAY' ? 'Delay recorded; the customer was told.' : 'Note added.',
      )
    ) {
      this.logNote = '';
      this.logPhotos.set([]);
    }
  }

  protected recordPayment(e: { method: PaymentMethod; amount: number; reference?: string }): void {
    this.run(
      (b, t) => b.recordPayment(t, this.id(), { ...e, idempotencyKey: idempotencyKey('pay') }),
      'Payment recorded.',
    );
  }

  protected async close(): Promise<void> {
    const disputed = this.status() === 'DISPUTED';
    const note = disputed
      ? await this.dialogs.prompt(
          'Resolve and close',
          'Record how the dispute was resolved. Both parties will see this.',
          'Resolution',
          'Close job',
        )
      : (await this.dialogs.confirm(
            'Close this job?',
            'The job moves to closed. Nothing else changes.',
            'Close job',
          ))
        ? ''
        : null;
    if (note === null) return;
    this.run((b, t) => b.closeJob(t, this.id(), note), 'Job closed.');
  }

  // ---------- Customer ----------

  protected async respond(q: RepairQuotation, approve: boolean): Promise<void> {
    const total = this.totals(q).total;
    if (approve) {
      const ok = await this.dialogs.confirm(
        'Approve this quotation?',
        `You agree to pay Rs ${total.toLocaleString('en-PK')} once the repair is delivered. The shop will start work.`,
        'Approve',
      );
      if (ok)
        this.run(
          (b, t) => b.respondToQuotation(t, this.id(), q.id, true),
          'Approved. The shop will start the repair.',
        );
    } else {
      const fee = this.job.value()!.job.diagnosticFee;
      const reason = await this.dialogs.prompt(
        'Reject the quotation?',
        `The phone will be returned without repair.${fee ? ` The diagnostic fee of Rs ${fee} you agreed to still applies.` : ''}`,
        'Why are you rejecting it?',
        'Reject',
        true,
        true,
      );
      if (reason)
        this.run(
          (b, t) => b.respondToQuotation(t, this.id(), q.id, false, reason),
          'Quotation rejected.',
        );
    }
  }

  protected async showCode(): Promise<void> {
    this.busy.set(true);
    try {
      this.handoverCode.set(await this.api.mutate((b, t) => b.generateHandoverCode(t, this.id())));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(): Promise<void> {
    const reason = await this.dialogs.prompt(
      'Cancel this repair request?',
      'This cannot be undone.',
      'Reason for cancelling',
      'Cancel request',
      true,
      true,
    );
    if (reason) this.run((b, t) => b.cancelJob(t, this.id(), reason), 'Request cancelled.');
  }

  protected reportTransfer(e: { amount: number; reference?: string }): void {
    this.run(
      (b, t) =>
        b.reportTransfer(t, this.id(), {
          amount: e.amount,
          reference: e.reference ?? '',
          idempotencyKey: idempotencyKey('ibft'),
        }),
      'Thanks. We will confirm your transfer shortly.',
    );
  }

  protected async review(): Promise<void> {
    const rating = this.reviewRating();
    if (!rating) return;
    if (
      await this.run(
        (b, t) => b.addReview(t, this.id(), { rating, comment: this.reviewComment }),
        'Thanks for your review!',
      )
    )
      this.reviewComment = '';
  }

  protected async dispute(): Promise<void> {
    const body = await this.dialogs.prompt(
      'Raise a dispute',
      'Our support team will review it with the shop. Tell us what went wrong.',
      'What went wrong?',
      'Raise dispute',
      true,
      true,
    );
    if (!body) return;
    this.run(
      (b, t) =>
        b.raiseComplaint(t, {
          jobId: this.id(),
          subject: `Dispute on ${this.job.value()!.job.ref}`,
          body: body.length >= 10 ? body : `${body} (customer dispute)`,
          isDispute: true,
        }),
      'Dispute raised. Support will contact you.',
    );
  }

  // ---------- Admin ----------

  protected async assign(): Promise<void> {
    const v = this.job.value()!;
    const ref = this.dialog.open(AssignDialog, {
      data: {
        jobId: v.job.id,
        ref: v.job.ref,
        currentVendorId: v.job.vendorId,
        timeoutHours: this.settings.value()?.acceptanceTimeoutHours ?? 4,
      },
      width: '560px',
      maxWidth: '94vw',
    });
    await firstValueFrom(ref.afterClosed());
  }

  protected publish(): void {
    this.run((b, t) => b.publishJob(t, this.id()), 'Published to eligible vendors.');
  }

  protected async adminCancel(): Promise<void> {
    const reason = await this.dialogs.prompt(
      'Cancel this job?',
      'The customer and vendor will be notified.',
      'Reason',
      'Cancel job',
      true,
      true,
    );
    if (reason) this.run((b, t) => b.cancelJob(t, this.id(), reason), 'Job cancelled.');
  }

  protected verify(txId: string): void {
    this.run((b, t) => b.verifyTransfer(t, txId), 'Transfer confirmed.');
  }

  protected async refund(): Promise<void> {
    const max = this.refundable();
    const reason = await this.dialogs.prompt(
      'Issue a refund',
      `Refund up to Rs ${max}. Enter the reason; the amount is the full refundable balance.`,
      'Reason',
      `Refund Rs ${max}`,
      true,
      true,
    );
    if (!reason) return;
    this.run(
      (b, t) =>
        b.issueRefund(t, this.id(), {
          amount: max,
          reason,
          collector: 'PLATFORM',
          idempotencyKey: idempotencyKey('refund'),
        }),
      'Refund recorded.',
    );
  }

  protected adminPayment(e: { method: PaymentMethod; amount: number; reference?: string }): void {
    this.recordPayment(e);
  }
}
