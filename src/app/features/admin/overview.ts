import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import {
  computeKpis,
  financialReport,
  isOverdue,
  operationalReport,
  presetRange,
  RangePreset,
} from '../../core/reports';
import { STATUS_META } from '../../core/workflow';
import { ChartColors, ChartComponent } from '../../shared/chart';
import { barChart, lineChart } from '../../shared/chart-configs';
import { KpiTile, Loading, PkrPipe, StatusBadge } from '../../shared/ui';

export const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

@Component({
  selector: 'app-overview',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonToggleModule,
    MatButtonModule,
    MatIconModule,
    KpiTile,
    PkrPipe,
    Loading,
    ChartComponent,
    StatusBadge,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Overview</h1>
          <p>
            Business-wide activity. Current queues are live; totals follow the selected period
            (Pakistan time).
          </p>
        </div>
        <mat-button-toggle-group
          [ngModel]="preset()"
          (ngModelChange)="preset.set($event)"
          aria-label="Period"
          class="periods"
        >
          @for (p of presets; track p.value) {
            <mat-button-toggle [value]="p.value">{{ p.label }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </header>

      @if (!data.hasValue()) {
        <div class="panel"><app-loading /></div>
      } @else {
        @let k = kpis()!;
        <h2 class="group">Right now</h2>
        <div class="kpis">
          <a routerLink="/admin/jobs" [queryParams]="{ status: 'AWAITING_VENDOR' }" class="plain"
            ><app-kpi
              label="Awaiting vendor"
              [value]="k.awaitingVendor"
              icon="hourglass_top"
              [alert]="k.awaitingVendor > 0"
          /></a>
          <app-kpi label="Active repairs" [value]="k.activeRepairs" icon="build" />
          <app-kpi
            label="Pending approvals"
            [value]="k.pendingApprovals"
            icon="pending_actions"
            hint="Quotes with customers"
          />
          <a routerLink="/admin/jobs" [queryParams]="{ status: 'OVERDUE' }" class="plain"
            ><app-kpi
              label="Delayed repairs"
              [value]="k.delayed"
              icon="alarm"
              hint="Past promised date"
              [alert]="k.delayed > 0"
          /></a>
          <app-kpi label="New today" [value]="k.newToday" icon="fiber_new" />
          <a routerLink="/admin/vendors" class="plain"
            ><app-kpi
              label="Vendors to approve"
              [value]="k.pendingVendors"
              icon="how_to_reg"
              [alert]="k.pendingVendors > 0"
          /></a>
        </div>

        <h2 class="group">Jobs in period</h2>
        <div class="kpis">
          <app-kpi label="Repair requests" [value]="k.totalRequests" icon="inbox" />
          <app-kpi label="Completed" [value]="k.completed" icon="task_alt" />
          <app-kpi label="Cancelled" [value]="k.cancelled" icon="cancel" />
          <app-kpi label="Unrepairable" [value]="k.unrepairable" icon="heart_broken" />
          <app-kpi label="Customers" [value]="k.totalCustomers" icon="group" hint="All time" />
          <app-kpi
            label="Approved vendors"
            [value]="k.totalVendors"
            icon="storefront"
            hint="All time"
          />
        </div>

        <h2 class="group">Money</h2>
        <div class="kpis">
          <app-kpi
            label="Gross repair value"
            [value]="k.grossValue | pkr"
            icon="request_quote"
            hint="Billable value of jobs created in period"
          />
          <app-kpi
            label="Collected payments"
            [value]="k.collected | pkr"
            icon="payments"
            hint="Ledger receipts in period"
          />
          <app-kpi
            label="Platform commission"
            [value]="k.commission | pkr"
            icon="percent"
            hint="On jobs finalised in period"
          />
          <app-kpi label="Refunds" [value]="k.refunds | pkr" icon="currency_exchange" />
          <app-kpi
            label="Outstanding"
            [value]="k.outstanding | pkr"
            icon="pending"
            hint="Delivered, not yet paid"
            [alert]="k.outstanding > 0"
          />
          <app-kpi
            label="Vendor payables"
            [value]="k.vendorPayable | pkr"
            icon="account_balance"
            hint="Owed to vendors now"
          />
        </div>

        <div class="grid-2">
          <section class="panel">
            <h2><mat-icon>bar_chart</mat-icon>Repair requests</h2>
            <app-chart
              [build]="requestsChart()"
              label="Repair requests per period"
              [height]="240"
            />
          </section>
          <section class="panel">
            <h2><mat-icon>show_chart</mat-icon>Collected payments</h2>
            <app-chart
              [build]="moneyChart()"
              label="Collected payments and commission over time"
              [height]="240"
            />
          </section>
          <section class="panel">
            <h2><mat-icon>stacked_bar_chart</mat-icon>Jobs by status</h2>
            <app-chart
              [build]="statusChart()"
              label="Number of jobs in each status"
              [height]="300"
            />
            <a mat-button routerLink="/admin/reports">Full reports</a>
          </section>
          <section class="panel">
            <h2><mat-icon>alarm</mat-icon>Overdue repairs</h2>
            @for (j of overdue(); track j.id) {
              <a class="overdue plain" [routerLink]="['/admin/jobs', j.id]">
                <span class="mono">{{ j.ref }}</span>
                <app-status [status]="j.status" />
                <span class="muted small">promised {{ j.promisedAt?.slice(0, 10) }}</span>
              </a>
            } @empty {
              <p class="muted">Nothing is overdue.</p>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .group {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 8px 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .kpis a {
      display: block;
    }
    .periods {
      flex-wrap: wrap;
    }
    .overdue {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      color: inherit;
      text-decoration: none;
      flex-wrap: wrap;
    }
  `,
})
export class Overview {
  private readonly api = inject(Api);
  protected readonly presets = PRESETS;
  protected readonly preset = signal<RangePreset>('30d');
  protected readonly data = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.reportData(t)),
  });
  protected readonly range = computed(() =>
    presetRange(this.preset(), new Date(this.data.value()?.now ?? Date.now())),
  );
  protected readonly kpis = computed(() =>
    this.data.value() ? computeKpis(this.data.value()!, this.range()) : null,
  );
  private readonly op = computed(() =>
    this.data.value() ? operationalReport(this.data.value()!, this.range()) : null,
  );
  private readonly fin = computed(() => {
    const d = this.data.value();
    if (!d) return null;
    const span = this.preset();
    return financialReport(
      d,
      this.range(),
      span === 'year' || span === 'all' ? 'month' : span === '90d' ? 'week' : 'day',
    );
  });
  protected readonly overdue = computed(() => {
    const d = this.data.value();
    return d ? d.jobs.filter((j) => isOverdue(j, d.now)).slice(0, 8) : [];
  });

  protected readonly requestsChart = computed(() => {
    const s = this.op()!.byDay;
    return (c: ChartColors) => barChart(c, s.keys.map(shortLabel), s.values, { label: 'Requests' });
  });
  protected readonly moneyChart = computed(() => {
    const f = this.fin()!;
    return (c: ChartColors) =>
      lineChart(
        c,
        f.keys.map(shortLabel),
        [
          { label: 'Collected', values: f.collectedSeries },
          { label: 'Commission', values: f.commissionSeries },
        ],
        { money: true },
      );
  });
  protected readonly statusChart = computed(() => {
    const rows = this.op()!.byStatus.slice(0, 10);
    return (c: ChartColors) =>
      barChart(
        c,
        rows.map((r) => STATUS_META[r.key as keyof typeof STATUS_META].label),
        rows.map((r) => r.count),
        { label: 'Jobs', horizontal: true },
      );
  });
}

/** "2026-10-27" → "27 Oct", "2026-10" → "Oct 26", "2026" stays. */
export function shortLabel(key: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  if (key.length === 10) return `${Number(key.slice(8))} ${months[Number(key.slice(5, 7)) - 1]}`;
  if (key.length === 7) return `${months[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
  return key;
}
