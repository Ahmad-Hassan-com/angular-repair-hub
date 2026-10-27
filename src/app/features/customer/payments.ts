import { Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { EmptyState, KpiTile, Loading, PkDatePipe, PkrPipe, StatusBadge } from '../../shared/ui';

/** Customer's money view: what's due, what's paid, receipts. */
@Component({
  selector: 'app-payments',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    StatusBadge,
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
          <h1>Payments and receipts</h1>
          <p>Amounts are only due once your phone is back with you.</p>
        </div>
      </header>
      @if (!jobs.hasValue()) {
        <div class="panel"><app-loading /></div>
      } @else if (!billed().length) {
        <div class="panel">
          <app-empty
            icon="receipt_long"
            title="Nothing billed yet"
            text="Approved quotations and receipts will appear here."
          />
        </div>
      } @else {
        <div class="kpis">
          <app-kpi
            label="Outstanding"
            [value]="totals().due | pkr"
            icon="pending"
            [alert]="totals().due > 0"
          />
          <app-kpi label="Total approved" [value]="totals().billed | pkr" icon="request_quote" />
          <app-kpi label="Paid" [value]="totals().paid | pkr" icon="payments" />
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Job</th>
                <th>Device</th>
                <th>Status</th>
                <th class="num">Total</th>
                <th class="num">Due</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              @for (j of billed(); track j.id) {
                <tr>
                  <td>
                    <a class="mono" [routerLink]="['/customer/jobs', j.id]">{{ j.ref }}</a>
                    <div class="muted small">{{ j.createdAt | pkDate: 'date' }}</div>
                  </td>
                  <td>{{ j.brand }} {{ j.model }}</td>
                  <td><app-status [status]="j.status" audience="customer" /></td>
                  <td class="num">{{ j.total | pkr }}</td>
                  <td class="num">{{ j.outstanding ? (j.outstanding | pkr) : '—' }}</td>
                  <td>
                    @if (
                      [
                        'DELIVERED',
                        'PAID',
                        'CLOSED',
                        'RETURNED_WITHOUT_REPAIR',
                        'REFUNDED',
                        'DISPUTED',
                      ].includes(j.status)
                    ) {
                      <a mat-button [routerLink]="['/receipt', j.id]"
                        ><mat-icon>download</mat-icon>View</a
                      >
                    } @else {
                      <span class="muted small">After delivery</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class Payments {
  private readonly api = inject(Api);
  protected readonly jobs = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.listJobs(t, { pageSize: 100 })),
  });
  protected readonly billed = computed(() =>
    (this.jobs.value()?.items ?? []).filter((j) => j.total > 0),
  );
  protected readonly totals = computed(() => {
    const rows = this.billed();
    const billed = rows.reduce((s, j) => s + j.total, 0);
    const due = rows
      .filter((j) => ['DELIVERED', 'RETURNED_WITHOUT_REPAIR', 'DISPUTED'].includes(j.status))
      .reduce((s, j) => s + j.outstanding, 0);
    const paid = rows.reduce((s, j) => s + (j.total - j.outstanding), 0);
    return { billed, due, paid };
  });
}
