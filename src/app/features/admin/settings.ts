import { Component, effect, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../../core/api';
import { AssignmentMode, PaymentMethod } from '../../core/models';
import { METHOD_LABEL } from '../../core/reports';
import { PkDatePipe, PkrPipe, Toast } from '../../shared/ui';

@Component({
  selector: 'app-admin-settings',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatIconModule,
    PkDatePipe,
    PkrPipe,
  ],
  template: `
    <div class="page narrow">
      <header class="page-header">
        <div>
          <h1>Settings</h1>
          <p>
            Business rules for assignment, pricing, commissions and handovers. Changes are audited.
          </p>
        </div>
      </header>
      <form [formGroup]="form" (ngSubmit)="save()" class="stack">
        <section class="panel">
          <h2><mat-icon>alt_route</mat-icon>Job assignment</h2>
          <mat-button-toggle-group formControlName="assignmentMode" aria-label="Assignment mode">
            <mat-button-toggle value="FIRST_ACCEPT"
              >First eligible vendor accepts</mat-button-toggle
            >
            <mat-button-toggle value="ADMIN_ASSIGN">Admin assigns</mat-button-toggle>
          </mat-button-toggle-group>
          <p class="muted small">
            {{
              form.value.assignmentMode === 'FIRST_ACCEPT'
                ? 'New requests are published to every eligible vendor; the first to accept gets the job.'
                : 'New requests wait for operations to offer them to one vendor, who accepts or declines.'
            }}
          </p>
          <div class="form-grid">
            <mat-form-field>
              <mat-label>Acceptance timeout (hours)</mat-label>
              <input
                matInput
                type="number"
                min="1"
                max="72"
                formControlName="acceptanceTimeoutHours"
              />
              <mat-hint>Unanswered offers return to the queue.</mat-hint>
            </mat-form-field>
          </div>
        </section>

        <section class="panel">
          <h2><mat-icon>percent</mat-icon>Commission and pricing</h2>
          <div class="form-grid">
            <mat-form-field>
              <mat-label>Commission (%)</mat-label>
              <input
                matInput
                type="number"
                min="0"
                max="50"
                step="0.5"
                formControlName="commissionPct"
              />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Fixed fee per job (Rs)</mat-label>
              <input matInput type="number" min="0" formControlName="commissionFixed" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Tax rate (%)</mat-label>
              <input
                matInput
                type="number"
                min="0"
                max="30"
                step="0.5"
                formControlName="taxRatePct"
              />
              <mat-hint>Applied to new quotations.</mat-hint>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Diagnostic fee (Rs)</mat-label>
              <input matInput type="number" min="0" formControlName="diagnosticFee" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Default pickup fee (Rs)</mat-label>
              <input matInput type="number" min="0" formControlName="defaultPickupFee" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Default delivery fee (Rs)</mat-label>
              <input matInput type="number" min="0" formControlName="defaultDeliveryFee" />
            </mat-form-field>
          </div>
          <p class="callout small">
            <mat-icon>info</mat-icon>
            <span>
              Example: on a Rs 10,000 repair the platform keeps
              {{ example() | pkr }} and the vendor earns {{ 10000 - example() | pkr }}. Each
              quotation stores the terms in force when it was sent, so changes never rewrite past
              jobs.
            </span>
          </p>
        </section>

        <section class="panel">
          <h2><mat-icon>payments</mat-icon>Payment methods</h2>
          @for (m of methods; track m) {
            <mat-checkbox
              [checked]="enabled().includes(m)"
              (change)="toggleMethod(m, $event.checked)"
              [disabled]="m === 'ONLINE' && !settings.value()?.onlineGateway?.configured"
            >
              {{ label[m] }}
              @if (m === 'ONLINE' && !settings.value()?.onlineGateway?.configured) {
                <span class="muted small">(no gateway configured)</span>
              }
            </mat-checkbox>
          }
        </section>

        <section class="panel">
          <h2><mat-icon>pin</mat-icon>Handover codes</h2>
          <div class="form-grid">
            <mat-form-field>
              <mat-label>Code valid for (minutes)</mat-label>
              <input matInput type="number" min="5" formControlName="otpTtlMinutes" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Wrong attempts allowed</mat-label>
              <input matInput type="number" min="3" max="10" formControlName="otpMaxAttempts" />
            </mat-form-field>
          </div>
          <p class="muted small">
            Codes are stored as salted hashes and never appear in logs or API responses to couriers.
          </p>
        </section>

        <section class="panel">
          <h2><mat-icon>policy</mat-icon>Review moderation policy</h2>
          <mat-form-field class="full-width">
            <mat-label>Policy shown to moderators</mat-label>
            <textarea matInput rows="3" formControlName="reviewPolicy"></textarea>
          </mat-form-field>
        </section>

        <div class="row">
          <button mat-flat-button type="submit" [disabled]="busy() || form.invalid">
            Save settings
          </button>
        </div>
      </form>

      <section class="panel mt">
        <h2><mat-icon>campaign</mat-icon>Notification and payment integrations</h2>
        <table class="data">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Provider</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>In-app</td>
              <td>Built in</td>
              <td><span class="tone success">active</span></td>
            </tr>
            @for (p of providers(); track p.channel) {
              <tr>
                <td>{{ p.channel }}</td>
                <td>{{ p.label }}</td>
                <td>
                  <span class="tone" [class]="p.configured ? 'success' : 'warning'">{{
                    p.configured ? 'configured' : 'not configured'
                  }}</span>
                </td>
              </tr>
            }
            <tr>
              <td>Online payments</td>
              <td>{{ settings.value()?.onlineGateway?.label }}</td>
              <td>
                <span class="tone warning">{{
                  settings.value()?.onlineGateway?.configured ? 'configured' : 'not configured'
                }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="muted small">
          Providers are configured with server environment variables (see .env.example). Without
          one, messages are shown in-app only and the attempt is logged below as "not configured";
          nothing claims to have been sent.
        </p>
        <h3>Recent outbound attempts</h3>
        <div class="table-wrap log">
          <table class="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Channel</th>
                <th>To</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              @for (l of log.value() ?? []; track l.id) {
                <tr>
                  <td class="small">{{ l.at | pkDate }}</td>
                  <td>{{ l.channel }}</td>
                  <td class="small">{{ mask(l.to) }}</td>
                  <td class="small">{{ l.status.replaceAll('_', ' ').toLowerCase() }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
  styles: `
    .narrow {
      max-width: 900px;
    }
    .callout {
      margin-top: 8px;
    }
    mat-checkbox {
      display: block;
    }
    .mt {
      margin-top: 16px;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 16px 0 8px;
    }
    .log {
      max-height: 320px;
    }
  `,
})
export class AdminSettings {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly methods: PaymentMethod[] = [
    'CASH_ON_DELIVERY',
    'CASH_TO_VENDOR',
    'BANK_TRANSFER',
    'ONLINE',
  ];
  protected readonly label = METHOD_LABEL;
  protected readonly busy = signal(false);
  protected readonly enabled = signal<PaymentMethod[]>([]);
  protected readonly settings = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.settings(t)),
  });
  protected readonly log = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.deliveryLog(t).slice(0, 50)),
  });
  protected readonly form = inject(FormBuilder).nonNullable.group({
    assignmentMode: ['FIRST_ACCEPT' as AssignmentMode],
    acceptanceTimeoutHours: [4, [Validators.required, Validators.min(1), Validators.max(72)]],
    commissionPct: [12, [Validators.required, Validators.min(0), Validators.max(50)]],
    commissionFixed: [0, [Validators.required, Validators.min(0)]],
    taxRatePct: [0, [Validators.required, Validators.min(0), Validators.max(30)]],
    defaultPickupFee: [0, [Validators.required, Validators.min(0)]],
    defaultDeliveryFee: [0, [Validators.required, Validators.min(0)]],
    diagnosticFee: [0, [Validators.required, Validators.min(0)]],
    otpTtlMinutes: [30, [Validators.required, Validators.min(5)]],
    otpMaxAttempts: [5, [Validators.required, Validators.min(3), Validators.max(10)]],
    reviewPolicy: [''],
  });

  constructor() {
    effect(() => {
      const s = this.settings.value();
      if (!s || this.form.dirty) return;
      this.form.patchValue(s);
      this.enabled.set(s.enabledPaymentMethods);
    });
  }

  protected example(): number {
    const v = this.form.getRawValue();
    return Math.min(
      10000,
      Math.round((10000 * Number(v.commissionPct)) / 100) + Number(v.commissionFixed),
    );
  }

  protected providers() {
    const p = this.settings.value()?.providers;
    return p
      ? (Object.entries(p) as [string, { configured: boolean; label: string }][]).map(
          ([channel, v]) => ({ channel, ...v }),
        )
      : [];
  }

  protected mask(to: string): string {
    return to.includes('@')
      ? to.replace(/^(.).*(@.*)$/, '$1•••$2')
      : to.replace(/\d(?=\d{3})/g, '•');
  }

  protected toggleMethod(m: PaymentMethod, on: boolean): void {
    this.enabled.update((list) => (on ? [...new Set([...list, m])] : list.filter((x) => x !== m)));
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const input = {
      ...v,
      acceptanceTimeoutHours: Number(v.acceptanceTimeoutHours),
      commissionPct: Number(v.commissionPct),
      commissionFixed: Math.round(Number(v.commissionFixed)),
      taxRatePct: Number(v.taxRatePct),
      defaultPickupFee: Math.round(Number(v.defaultPickupFee)),
      defaultDeliveryFee: Math.round(Number(v.defaultDeliveryFee)),
      diagnosticFee: Math.round(Number(v.diagnosticFee)),
      otpTtlMinutes: Math.round(Number(v.otpTtlMinutes)),
      otpMaxAttempts: Math.round(Number(v.otpMaxAttempts)),
      enabledPaymentMethods: this.enabled(),
    };
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.updateSettings(t, input));
      this.form.markAsPristine();
      this.toast.ok('Settings saved.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
