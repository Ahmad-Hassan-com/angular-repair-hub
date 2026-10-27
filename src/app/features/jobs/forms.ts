import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ConditionInput, ScheduleInput } from '../../core/backend';
import { PaymentMethod, TIME_WINDOWS, TimeWindow } from '../../core/models';
import { pkDay, METHOD_LABEL } from '../../core/reports';
import { PhotoUpload } from '../../shared/files';
import { PkrPipe } from '../../shared/ui';

const COMMON = [
  ReactiveFormsModule,
  MatFormFieldModule,
  MatInputModule,
  MatSelectModule,
  MatButtonModule,
  MatIconModule,
];

/** Date, time window, fee and who goes: used for pickups and deliveries. */
@Component({
  selector: 'app-schedule-form',
  imports: [...COMMON],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
      <mat-form-field>
        <mat-label>Date</mat-label>
        <input matInput type="date" formControlName="date" [min]="today" />
        <mat-error>Choose today or a later date.</mat-error>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Time window</mat-label>
        <mat-select formControlName="window">
          @for (w of windows; track w) {
            <mat-option [value]="w">{{ w }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Who goes</mat-label>
        <mat-select formControlName="assigneeId">
          <mat-option value="">{{ selfLabel() }}</mat-option>
          @for (a of agents(); track a.id) {
            <mat-option [value]="a.id">{{ a.name }} (delivery agent)</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Visit fee shown on the task (Rs)</mat-label>
        <input matInput type="number" min="0" step="50" formControlName="fee" />
        <mat-hint>Billed to the customer through the quotation.</mat-hint>
      </mat-form-field>
      <mat-form-field class="full">
        <mat-label>Note for the customer (optional)</mat-label>
        <input matInput formControlName="note" maxlength="300" />
      </mat-form-field>
      <div class="full row end">
        @if (cancellable()) {
          <button mat-button type="button" (click)="cancelled.emit()">Cancel</button>
        }
        <button mat-flat-button type="submit" [disabled]="busy()">{{ submitLabel() }}</button>
      </div>
    </form>
  `,
  styles: `
    .end {
      justify-content: flex-end;
    }
  `,
})
export class ScheduleForm implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly agents = input<{ id: string; name: string }[]>([]);
  readonly defaultDate = input<string>();
  readonly defaultWindow = input<TimeWindow>('12:00-15:00');
  readonly fee = input(0);
  readonly submitLabel = input('Schedule');
  readonly selfLabel = input('The repair shop');
  readonly busy = input(false);
  readonly cancellable = input(false);
  readonly submitted = output<ScheduleInput>();
  readonly cancelled = output<void>();

  protected readonly windows = TIME_WINDOWS;
  protected readonly today = pkDay(new Date());
  protected readonly form = this.fb.group({
    date: [this.today, Validators.required],
    window: ['12:00-15:00' as TimeWindow],
    assigneeId: [''],
    fee: [0, [Validators.min(0)]],
    note: [''],
  });

  ngOnInit(): void {
    const preferred = this.defaultDate();
    this.form.patchValue({
      date: preferred && preferred >= this.today ? preferred : this.today,
      window: this.defaultWindow(),
      fee: this.fee(),
    });
  }

  protected submit(): void {
    if (this.form.invalid || this.form.value.date! < this.today) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.submitted.emit({
      date: v.date,
      window: v.window,
      fee: Math.round(v.fee),
      assigneeId: v.assigneeId || undefined,
      note: v.note || undefined,
    });
  }
}

/** Collection: handover code plus a device condition report. Delivery: code plus optional proof. */
@Component({
  selector: 'app-handover-form',
  imports: [...COMMON, MatButtonToggleModule, MatCheckboxModule, MatChipsModule, PhotoUpload],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-form-field class="otp">
        <mat-label>Customer's handover code</mat-label>
        <input
          matInput
          formControlName="otp"
          inputmode="numeric"
          maxlength="6"
          autocomplete="one-time-code"
          class="mono"
        />
        <mat-hint>Ask the customer to open the job and read out their 6-digit code.</mat-hint>
        <mat-error>Enter the 6-digit code.</mat-error>
      </mat-form-field>

      @if (mode() === 'pickup') {
        <h3>Device condition at pickup</h3>
        <div class="row cond">
          <span class="muted small" id="cond-label">Physical condition</span>
          <mat-button-toggle-group formControlName="physicalCondition" aria-labelledby="cond-label">
            @for (c of conditions; track c) {
              <mat-button-toggle [value]="c">{{
                c.charAt(0) + c.slice(1).toLowerCase()
              }}</mat-button-toggle>
            }
          </mat-button-toggle-group>
        </div>
        <div class="form-grid">
          <mat-form-field class="full">
            <mat-label>Existing damage</mat-label>
            <input
              matInput
              formControlName="existingDamage"
              placeholder="e.g. scratches on the frame, dent near charging port"
            />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Accessories received</mat-label>
            <mat-select formControlName="accessories" multiple>
              @for (a of accessories; track a) {
                <mat-option [value]="a">{{ a }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>IMEI (optional)</mat-label>
            <input
              matInput
              formControlName="imei"
              inputmode="numeric"
              maxlength="15"
              class="mono"
            />
            <mat-hint>Dial *#06#. Visible only to your shop and admins.</mat-hint>
            <mat-error>IMEI must be 15 digits.</mat-error>
          </mat-form-field>
        </div>
        <mat-checkbox formControlName="powersOn">Phone powers on</mat-checkbox>
        <p class="callout warning small">
          <mat-icon>lock</mat-icon>
          <span>Never ask for the customer's passcode or unlock pattern.</span>
        </p>
      } @else {
        <mat-form-field class="full-width">
          <mat-label>Delivery note (optional)</mat-label>
          <input
            matInput
            formControlName="existingDamage"
            placeholder="e.g. handed to customer's brother at the gate"
          />
        </mat-form-field>
      }
      <app-photo-upload
        [(ids)]="photos"
        [max]="4"
        [label]="mode() === 'pickup' ? 'Condition photo' : 'Proof photo'"
      />

      <div class="row end">
        <button mat-flat-button type="submit" [disabled]="busy()">
          <mat-icon>verified</mat-icon>
          {{
            mode() === 'pickup'
              ? 'Verify code and confirm collection'
              : 'Verify code and confirm delivery'
          }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .otp {
      width: 260px;
      max-width: 100%;
    }
    .otp input {
      letter-spacing: 0.3em;
      font-size: 1.2rem;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 16px 0 8px;
    }
    .cond {
      margin-bottom: 12px;
    }
    .callout {
      margin: 8px 0 12px;
    }
    .end {
      justify-content: flex-end;
      margin-top: 12px;
    }
  `,
})
export class HandoverForm {
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly mode = input.required<'pickup' | 'delivery'>();
  readonly busy = input(false);
  readonly submitted = output<{
    otp: string;
    condition: ConditionInput;
    note: string;
    photoIds: string[];
  }>();

  protected readonly conditions = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;
  protected readonly accessories = ['Case', 'Charger', 'Cable', 'SIM tray', 'Box', 'Earphones'];
  protected readonly photos = signal<string[]>([]);
  protected readonly form = this.fb.group({
    otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    physicalCondition: ['GOOD' as (typeof this.conditions)[number]],
    existingDamage: [''],
    accessories: [[] as string[]],
    imei: ['', Validators.pattern(/^\d{15}$/)],
    powersOn: [true],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.submitted.emit({
      otp: v.otp,
      note: v.existingDamage,
      photoIds: this.photos(),
      condition: {
        physicalCondition: v.physicalCondition,
        existingDamage: v.existingDamage,
        accessories: v.accessories,
        imei: v.imei || undefined,
        powersOn: v.powersOn,
        photoIds: this.photos(),
      },
    });
  }
}

/** Records money received against a job. */
@Component({
  selector: 'app-payment-form',
  imports: [...COMMON, PkrPipe],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
      <mat-form-field>
        <mat-label>Method</mat-label>
        <mat-select formControlName="method">
          @for (m of methods(); track m) {
            <mat-option [value]="m">{{ label[m] }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Amount (Rs)</mat-label>
        <input matInput type="number" min="1" [max]="outstanding()" formControlName="amount" />
        <mat-hint>Outstanding: {{ outstanding() | pkr }}</mat-hint>
        <mat-error>Enter 1 to {{ outstanding() }}.</mat-error>
      </mat-form-field>
      <mat-form-field class="full">
        <mat-label>Reference {{ needsReference() ? '' : '(optional)' }}</mat-label>
        <input
          matInput
          formControlName="reference"
          maxlength="60"
          placeholder="e.g. IBFT or receipt number"
        />
        <mat-error>Enter the transfer reference.</mat-error>
      </mat-form-field>
      <div class="full row end">
        <button mat-flat-button type="submit" [disabled]="busy()">{{ submitLabel() }}</button>
      </div>
    </form>
  `,
  styles: `
    .end {
      justify-content: flex-end;
    }
  `,
})
export class PaymentForm implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly methods = input.required<PaymentMethod[]>();
  readonly outstanding = input.required<number>();
  readonly needsReference = input(false);
  readonly submitLabel = input('Record payment');
  readonly busy = input(false);
  readonly submitted = output<{ method: PaymentMethod; amount: number; reference?: string }>();

  protected readonly label = METHOD_LABEL;
  protected readonly form = this.fb.group({
    method: ['CASH_ON_DELIVERY' as PaymentMethod],
    amount: [0, [Validators.required, Validators.min(1)]],
    reference: [''],
  });

  ngOnInit(): void {
    this.form.patchValue({ method: this.methods()[0], amount: this.outstanding() });
    this.form.controls.amount.addValidators(Validators.max(this.outstanding()));
    if (this.needsReference()) this.form.controls.reference.addValidators(Validators.required);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.submitted.emit({
      method: v.method,
      amount: Math.round(v.amount),
      reference: v.reference || undefined,
    });
  }
}
