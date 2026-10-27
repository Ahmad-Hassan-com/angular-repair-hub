import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuotationInput } from '../../core/backend';
import { commissionFor, quoteTotals } from '../../core/finance';
import { QuotationItem, QuoteItemType, SystemSettings } from '../../core/models';
import { pkDay } from '../../core/reports';
import { PkrPipe } from '../../shared/ui';

const TYPES: { value: QuoteItemType; label: string }[] = [
  { value: 'PART', label: 'Part' },
  { value: 'LABOR', label: 'Labour' },
  { value: 'DIAGNOSTIC', label: 'Diagnostic' },
  { value: 'DELIVERY', label: 'Pickup/delivery' },
  { value: 'OTHER', label: 'Other' },
];

@Component({
  selector: 'app-quotation-form',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    PkrPipe,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="form-grid">
        <mat-form-field class="full">
          <mat-label>Inspection findings</mat-label>
          <textarea matInput rows="2" formControlName="findings"></textarea>
          <mat-error>Describe what you found (at least 5 characters).</mat-error>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Proposed repair</mat-label>
          <input matInput formControlName="proposedRepair" />
          <mat-error>Describe the proposed repair.</mat-error>
        </mat-form-field>
      </div>

      <div class="items" formArrayName="items">
        <div class="items-head">
          <h3>Line items</h3>
          <button
            mat-stroked-button
            type="button"
            (click)="addItem()"
            [disabled]="items.length >= 20"
          >
            <mat-icon>add</mat-icon>Add line
          </button>
        </div>
        @for (row of items.controls; track row; let i = $index) {
          <div class="item" [formGroupName]="i">
            <mat-form-field class="type" subscriptSizing="dynamic">
              <mat-label>Type</mat-label>
              <mat-select formControlName="type">
                @for (t of types; track t.value) {
                  <mat-option [value]="t.value">{{ t.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field class="desc" subscriptSizing="dynamic">
              <mat-label>Description</mat-label>
              <input matInput formControlName="description" />
            </mat-form-field>
            <mat-form-field class="qty" subscriptSizing="dynamic">
              <mat-label>Qty</mat-label>
              <input matInput type="number" min="1" max="99" step="1" formControlName="quantity" />
            </mat-form-field>
            <mat-form-field class="price" subscriptSizing="dynamic">
              <mat-label>Unit price (Rs)</mat-label>
              <input matInput type="number" min="0" step="50" formControlName="unitPrice" />
            </mat-form-field>
            <button
              mat-icon-button
              type="button"
              (click)="items.removeAt(i)"
              [disabled]="items.length === 1"
              [attr.aria-label]="'Remove line ' + (i + 1)"
              matTooltip="Remove line"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        }
      </div>

      <div class="form-grid">
        <mat-form-field>
          <mat-label>Discount (Rs)</mat-label>
          <input matInput type="number" min="0" step="50" formControlName="discount" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Warranty (days)</mat-label>
          <mat-select formControlName="warrantyDays">
            @for (d of [0, 7, 30, 60, 90, 180]; track d) {
              <mat-option [value]="d">{{ d ? d + ' days' : 'No warranty' }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Estimated completion</mat-label>
          <input matInput type="date" formControlName="estimatedCompletion" [min]="today" />
          <mat-error>Choose today or a later date.</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Notes for the customer (optional)</mat-label>
          <input matInput formControlName="notes" maxlength="500" />
        </mat-form-field>
      </div>

      <div class="summary">
        <div><span class="muted">Subtotal</span> {{ totals().subtotal | pkr }}</div>
        @if (totals().tax) {
          <div>
            <span class="muted">Tax ({{ settings().taxRatePct }}%)</span> {{ totals().tax | pkr }}
          </div>
        }
        <div class="grand"><span>Customer pays</span> {{ totals().total | pkr }}</div>
        <div class="muted small">
          Platform commission {{ commission() | pkr }} ({{ settings().commissionPct }}% +
          {{ settings().commissionFixed | pkr }}) · You earn
          {{ totals().total - totals().tax - commission() | pkr }}
        </div>
      </div>

      @if (problem()) {
        <p class="callout danger" role="alert"><mat-icon>error</mat-icon>{{ problem() }}</p>
      }
      <div class="row end">
        <button mat-button type="button" (click)="cancelled.emit()">Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ revision() ? 'Send revised quotation' : 'Send quotation to customer' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .items {
      margin: 4px 0 16px;
    }
    .items-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 0;
    }
    .item {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr) 80px 130px 40px;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    @media (max-width: 720px) {
      .item {
        grid-template-columns: 1fr 1fr 40px;
      }
      .desc {
        grid-column: 1 / -1;
        grid-row: 1;
      }
    }
    .summary {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container);
      margin-bottom: 12px;
      text-align: right;
    }
    .summary .muted {
      margin-right: 8px;
    }
    .grand {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
    }
    .grand span {
      margin-right: 8px;
    }
    .end {
      justify-content: flex-end;
    }
    .callout {
      margin-bottom: 12px;
    }
  `,
})
export class QuotationForm implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly settings = input.required<SystemSettings>();
  /** Previous quotation lines to start a revision from. */
  readonly previous = input<QuotationItem[] | undefined>();
  readonly revision = input(false);
  readonly busy = input(false);
  readonly submitted = output<QuotationInput>();
  readonly cancelled = output<void>();

  protected readonly types = TYPES;
  protected readonly today = pkDay(new Date());
  protected readonly problem = signal('');

  protected readonly form = this.fb.group({
    findings: ['', [Validators.required, Validators.minLength(5)]],
    proposedRepair: ['', [Validators.required, Validators.minLength(5)]],
    items: this.fb.array<ReturnType<QuotationForm['itemGroup']>>([]),
    discount: [0, [Validators.min(0)]],
    warrantyDays: [30],
    estimatedCompletion: [pkDay(new Date(Date.now() + 2 * 86_400_000)), Validators.required],
    notes: [''],
  });

  protected get items(): FormArray<ReturnType<QuotationForm['itemGroup']>> {
    return this.form.controls.items;
  }

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  private readonly cleanItems = computed(() =>
    (this.value().items ?? []).map((i) => ({
      type: (i.type ?? 'PART') as QuoteItemType,
      description: i.description ?? '',
      quantity: Math.round(Number(i.quantity) || 0),
      unitPrice: Math.round(Number(i.unitPrice) || 0),
    })),
  );
  protected readonly totals = computed(() =>
    quoteTotals(
      this.cleanItems(),
      Math.round(Number(this.value().discount) || 0),
      this.settings().taxRatePct,
    ),
  );
  protected readonly commission = computed(() => {
    const t = this.totals();
    return commissionFor(
      t.total - t.tax,
      this.settings().commissionPct,
      this.settings().commissionFixed,
    );
  });

  ngOnInit(): void {
    const prev = this.previous();
    if (prev?.length) {
      for (const i of prev) this.addItem(i);
    } else {
      this.addItem({ type: 'PART', description: '', quantity: 1, unitPrice: 0 });
      this.addItem({ type: 'LABOR', description: 'Labour', quantity: 1, unitPrice: 0 });
      const delivery = this.settings().defaultPickupFee + this.settings().defaultDeliveryFee;
      if (delivery)
        this.addItem({
          type: 'DELIVERY',
          description: 'Pickup and delivery',
          quantity: 1,
          unitPrice: delivery,
        });
    }
  }

  private itemGroup(i?: QuotationItem) {
    return this.fb.group({
      type: [i?.type ?? ('PART' as QuoteItemType)],
      description: [i?.description ?? '', [Validators.required, Validators.minLength(2)]],
      quantity: [i?.quantity ?? 1, [Validators.required, Validators.min(1), Validators.max(99)]],
      unitPrice: [i?.unitPrice ?? 0, [Validators.required, Validators.min(0)]],
    });
  }

  protected addItem(i?: QuotationItem): void {
    this.items.push(this.itemGroup(i));
  }

  protected submit(): void {
    this.problem.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.problem.set(
        'Check the highlighted fields: every line needs a description, a quantity of 1–99 and a price.',
      );
      return;
    }
    const items = this.cleanItems();
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) {
      this.problem.set('Quantities must be whole numbers.');
      return;
    }
    const v = this.form.getRawValue();
    if (v.discount > this.totals().subtotal) {
      this.problem.set('Discount cannot exceed the subtotal.');
      return;
    }
    this.submitted.emit({
      findings: v.findings,
      proposedRepair: v.proposedRepair,
      items,
      discount: Math.round(v.discount),
      estimatedCompletion: v.estimatedCompletion,
      warrantyDays: v.warrantyDays,
      notes: v.notes || undefined,
    });
  }
}
