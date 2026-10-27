import { Component, inject, resource } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { EmptyState, KpiTile, Loading, PkDatePipe, PkrPipe, StatusBadge } from '../../shared/ui';

@Component({
  selector: 'app-earnings',
  imports: [
    RouterLink,
    MatIconModule,
    KpiTile,
    PkrPipe,
    PkDatePipe,
    StatusBadge,
    Loading,
    EmptyState,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Earnings and settlements</h1>
          <p>What you've earned, what you've collected, and who owes whom.</p>
        </div>
      </header>
      @if (!data.hasValue()) {
        <app-loading />
      } @else {
        @let b = data.value()!.balance;
        <div class="kpis">
          <app-kpi
            label="Earned (final jobs)"
            [value]="b.earnings | pkr"
            icon="savings"
            hint="After platform commission"
          />
          <app-kpi label="Commission paid" [value]="b.commission | pkr" icon="percent" />
          <app-kpi label="Cash you collected" [value]="b.heldByVendor | pkr" icon="payments" />
          <app-kpi
            label="Settled to date"
            [value]="b.settled | pkr"
            icon="account_balance"
            hint="Positive: paid to you"
          />
          <app-kpi
            [label]="b.balance >= 0 ? 'Platform owes you' : 'You owe the platform'"
            [value]="abs(b.balance) | pkr"
            icon="balance"
            [alert]="b.balance < 0"
          />
          <app-kpi
            label="Pending"
            [value]="b.pending | pkr"
            icon="schedule"
            hint="Approved jobs not yet final"
          />
        </div>
        <p class="callout small">
          <mat-icon>info</mat-icon>
          <span
            >Balance = your earnings on paid jobs − cash you collected from customers − settlements.
            When you collect cash, you owe the platform its commission; when the platform collects,
            it owes you your earnings.</span
          >
        </p>

        <div class="grid-2 mt">
          <section class="panel">
            <h2><mat-icon>receipt_long</mat-icon>Earnings by job</h2>
            @if (data.value()!.earningsByJob.length) {
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Status</th>
                      <th class="num">Total</th>
                      <th class="num">Commission</th>
                      <th class="num">You earn</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (e of data.value()!.earningsByJob.slice(0, 30); track e.id) {
                      <tr>
                        <td>
                          <a class="mono" [routerLink]="['/vendor/jobs', e.id]">{{ e.ref }}</a>
                          <div class="muted small">{{ e.updatedAt | pkDate: 'date' }}</div>
                        </td>
                        <td><app-status [status]="e.status" /></td>
                        <td class="num">{{ e.total | pkr }}</td>
                        <td class="num">{{ e.commission | pkr }}</td>
                        <td class="num">{{ e.vendorEarnings | pkr }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <app-empty icon="savings" title="No completed jobs yet" />
            }
          </section>
          <section class="panel">
            <h2><mat-icon>account_balance</mat-icon>Settlements</h2>
            @for (s of settlements.value() ?? []; track s.id) {
              <div class="settle row">
                <div>
                  <strong
                    >{{ s.amount > 0 ? 'Paid to you' : 'You paid' }}
                    {{ abs(s.amount) | pkr }}</strong
                  >
                  <div class="muted small">
                    {{ s.at | pkDate: 'date' }} · ref <span class="mono">{{ s.reference }}</span>
                  </div>
                </div>
              </div>
            } @empty {
              <p class="muted">No settlements yet. The platform settles balances periodically.</p>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .mt {
      margin-top: 16px;
    }
    .settle {
      padding: 10px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
  `,
})
export class Earnings {
  private readonly api = inject(Api);
  protected readonly data = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.vendorDashboard(t)),
  });
  protected readonly settlements = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.settlements(t)),
  });
  protected abs = Math.abs;
}
