import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { downloadCsv, METHOD_LABEL, pkDay, toCsv } from '../../core/reports';
import { Session } from '../../core/session';
import { Dialogs } from '../../shared/dialogs';
import { EmptyState, KpiTile, Loading, PkDatePipe, PkrPipe, Toast } from '../../shared/ui';

@Component({
  selector: 'app-admin-finance',
  imports: [
    FormsModule,
    RouterLink,
    MatTabsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    PkrPipe,
    PkDatePipe,
    Loading,
    EmptyState,
    KpiTile,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Payments and settlements</h1>
          <p>
            The ledger is append-only: corrections are new entries (refunds, settlements), never
            edits.
          </p>
        </div>
      </header>

      @if (!ledger.hasValue()) {
        <app-loading />
      } @else {
        <div class="kpis">
          <app-kpi label="Payments received" [value]="totals().payments | pkr" icon="payments" />
          <app-kpi label="Refunded" [value]="totals().refunds | pkr" icon="currency_exchange" />
          <app-kpi
            label="Awaiting verification"
            [value]="pending().length"
            icon="pending"
            [alert]="pending().length > 0"
          />
          <app-kpi
            label="Held by vendors (net)"
            [value]="totals().vendorHeld | pkr"
            icon="storefront"
            hint="Cash vendors collected"
          />
        </div>

        <mat-tab-group animationDuration="0ms">
          <mat-tab [label]="'Verify transfers (' + pending().length + ')'">
            <div class="tab">
              @for (t of pending(); track t.id) {
                <div class="callout warning row">
                  <mat-icon>account_balance</mat-icon>
                  <span>
                    <a class="mono" [routerLink]="['/admin/jobs', t.jobId]">{{ t.jobRef }}</a
                    >: customer reported {{ t.amount | pkr }}, ref
                    <span class="mono">{{ t.reference }}</span
                    >, {{ t.at | pkDate }}
                  </span>
                  <span class="spacer"></span>
                  <button mat-flat-button type="button" (click)="verify(t.id)" [disabled]="busy()">
                    Confirm received
                  </button>
                </div>
              } @empty {
                <app-empty
                  icon="task_alt"
                  title="Nothing to verify"
                  text="Customer-reported bank transfers appear here."
                />
              }
            </div>
          </mat-tab>

          <mat-tab label="Ledger">
            <div class="tab">
              <div class="row filters">
                <mat-button-toggle-group
                  [ngModel]="kind()"
                  (ngModelChange)="kind.set($event)"
                  aria-label="Entry type"
                >
                  <mat-button-toggle value="">All</mat-button-toggle>
                  <mat-button-toggle value="PAYMENT">Payments</mat-button-toggle>
                  <mat-button-toggle value="REFUND">Refunds</mat-button-toggle>
                </mat-button-toggle-group>
                <span class="spacer"></span>
                <button mat-stroked-button type="button" (click)="exportLedger()">
                  <mat-icon>download</mat-icon>Export CSV
                </button>
              </div>
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Job</th>
                      <th>Vendor</th>
                      <th>Type</th>
                      <th>Method</th>
                      <th>Held by</th>
                      <th class="num">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (t of rows().slice(0, 200); track t.id) {
                      <tr>
                        <td class="small">{{ t.at | pkDate }}</td>
                        <td>
                          <a class="mono" [routerLink]="['/admin/jobs', t.jobId]">{{ t.jobRef }}</a>
                        </td>
                        <td>{{ t.vendorName ?? '—' }}</td>
                        <td>{{ t.kind === 'REFUND' ? 'Refund' : 'Payment' }}</td>
                        <td>{{ method[t.method] }}</td>
                        <td>{{ t.collector === 'VENDOR' ? 'Vendor' : 'Platform' }}</td>
                        <td class="num">
                          {{ t.kind === 'REFUND' ? '−' : '' }}{{ t.amount | pkr }}
                        </td>
                        <td>
                          <span
                            class="tone"
                            [class]="t.status === 'CONFIRMED' ? 'success' : 'warning'"
                            >{{ t.status === 'CONFIRMED' ? 'confirmed' : 'pending' }}</span
                          >
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (rows().length > 200) {
                <p class="muted small">
                  Showing the latest 200 of {{ rows().length }}. Export for the full ledger.
                </p>
              }
            </div>
          </mat-tab>

          @if (session.can('settlements.manage')) {
            <mat-tab label="Vendor balances">
              <div class="tab">
                <p class="callout small">
                  <mat-icon>info</mat-icon>
                  <span
                    >Balance = vendor earnings on final jobs − cash the vendor collected −
                    settlements. Positive: the platform owes the vendor (pay out). Negative: the
                    vendor owes commission (collect).</span
                  >
                </p>
                <div class="table-wrap">
                  <table class="data">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th class="num">Earnings</th>
                        <th class="num">Commission</th>
                        <th class="num">Cash held</th>
                        <th class="num">Settled</th>
                        <th class="num">Balance</th>
                        <th class="num">Pending</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (b of balances.value() ?? []; track b.vendorId) {
                        <tr>
                          <td>
                            {{ b.shopName }}
                            <div class="muted small">
                              {{
                                b.payout
                                  ? b.payout.bankName + ' ••' + b.payout.last4
                                  : 'No payout account'
                              }}
                            </div>
                          </td>
                          <td class="num">{{ b.earnings | pkr }}</td>
                          <td class="num">{{ b.commission | pkr }}</td>
                          <td class="num">{{ b.heldByVendor | pkr }}</td>
                          <td class="num">{{ b.settled | pkr }}</td>
                          <td class="num" [class.neg]="b.balance < 0">
                            <strong>{{ b.balance | pkr }}</strong>
                          </td>
                          <td class="num muted">{{ b.pending | pkr }}</td>
                          <td>
                            @if (b.balance !== 0) {
                              <button
                                mat-stroked-button
                                type="button"
                                (click)="settle(b.vendorId, b.shopName, b.balance)"
                                [disabled]="busy()"
                              >
                                {{ b.balance > 0 ? 'Record payout' : 'Record collection' }}
                              </button>
                            } @else {
                              <span class="tone success">settled</span>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <h3>Settlement history</h3>
                <div class="table-wrap">
                  <table class="data">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Vendor</th>
                        <th>Direction</th>
                        <th class="num">Amount</th>
                        <th>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (s of settlements.value() ?? []; track s.id) {
                        <tr>
                          <td class="small">{{ s.at | pkDate }}</td>
                          <td>{{ s.shopName }}</td>
                          <td>{{ s.amount > 0 ? 'Paid to vendor' : 'Collected from vendor' }}</td>
                          <td class="num">{{ abs(s.amount) | pkr }}</td>
                          <td class="mono">{{ s.reference }}</td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="5" class="muted">No settlements yet.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </mat-tab>
          }
        </mat-tab-group>
      }
    </div>
  `,
  styles: `
    .tab {
      padding: 16px 0;
    }
    .callout {
      margin-bottom: 12px;
    }
    .filters {
      margin-bottom: 12px;
    }
    .neg {
      color: var(--tone-danger-fg);
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 20px 0 8px;
    }
  `,
})
export class AdminFinance {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly dialogs = inject(Dialogs);
  protected readonly session = inject(Session);
  protected readonly method = METHOD_LABEL;
  protected readonly abs = Math.abs;
  protected readonly busy = signal(false);
  protected readonly kind = signal<'' | 'PAYMENT' | 'REFUND'>('');

  protected readonly ledger = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.ledger(t)),
  });
  protected readonly balances = resource({
    params: () => ({ rev: this.api.revision(), ok: this.session.can('settlements.manage') }),
    loader: ({ params }) =>
      params.ok ? this.api.query((b, t) => b.vendorBalances(t)) : Promise.resolve([]),
  });
  protected readonly settlements = resource({
    params: () => ({ rev: this.api.revision(), ok: this.session.can('settlements.manage') }),
    loader: ({ params }) =>
      params.ok ? this.api.query((b, t) => b.settlements(t)) : Promise.resolve([]),
  });

  protected readonly pending = computed(() =>
    (this.ledger.value() ?? []).filter((t) => t.status === 'PENDING_VERIFICATION'),
  );
  protected readonly rows = computed(() =>
    (this.ledger.value() ?? []).filter((t) => !this.kind() || t.kind === this.kind()),
  );
  protected readonly totals = computed(() => {
    const rows = (this.ledger.value() ?? []).filter((t) => t.status === 'CONFIRMED');
    const sum = (f: (t: (typeof rows)[number]) => boolean) =>
      rows.filter(f).reduce((s, t) => s + t.amount, 0);
    return {
      payments: sum((t) => t.kind === 'PAYMENT'),
      refunds: sum((t) => t.kind === 'REFUND'),
      vendorHeld:
        sum((t) => t.kind === 'PAYMENT' && t.collector === 'VENDOR') -
        sum((t) => t.kind === 'REFUND' && t.collector === 'VENDOR'),
    };
  });

  protected async verify(id: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.verifyTransfer(t, id));
      this.toast.ok('Transfer confirmed.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async settle(vendorId: string, shop: string, balance: number): Promise<void> {
    const ref = await this.dialogs.prompt(
      balance > 0 ? `Pay ${shop}` : `Collect from ${shop}`,
      `${balance > 0 ? 'Record a payout of' : 'Record a collection of'} Rs ${Math.abs(balance).toLocaleString('en-PK')}. Enter the bank or cash reference.`,
      'Reference',
      'Record settlement',
    );
    if (!ref) return;
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.createSettlement(t, vendorId, balance, ref));
      this.toast.ok('Settlement recorded.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected exportLedger(): void {
    downloadCsv(
      `ledger-${pkDay(new Date())}.csv`,
      toCsv(this.rows(), [
        { header: 'Date (PKT)', value: (t) => pkDay(t.at) },
        { header: 'Job', value: (t) => t.jobRef },
        { header: 'Vendor', value: (t) => t.vendorName },
        { header: 'Type', value: (t) => t.kind },
        { header: 'Method', value: (t) => METHOD_LABEL[t.method] },
        { header: 'Held by', value: (t) => t.collector },
        { header: 'Amount (PKR)', value: (t) => (t.kind === 'REFUND' ? -t.amount : t.amount) },
        { header: 'Status', value: (t) => t.status },
        { header: 'Reference', value: (t) => t.reference },
        { header: 'Reason', value: (t) => t.reason },
      ]),
    );
  }
}
