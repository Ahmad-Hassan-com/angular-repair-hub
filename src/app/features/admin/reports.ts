import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import {
  CountRow,
  CsvColumn,
  DateRange,
  downloadCsv,
  financialReport,
  Granularity,
  operationalReport,
  presetRange,
  RangePreset,
  toCsv,
} from '../../core/reports';
import { STATUS_META } from '../../core/workflow';
import { ChartColors, ChartComponent } from '../../shared/chart';
import { barChart, lineChart } from '../../shared/chart-configs';
import { HoursPipe, KpiTile, Loading, PctPipe, PkrPipe } from '../../shared/ui';
import { PRESETS, shortLabel } from './overview';

@Component({
  selector: 'app-admin-reports',
  imports: [
    FormsModule,
    RouterLink,
    MatTabsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    ChartComponent,
    KpiTile,
    PkrPipe,
    PctPipe,
    HoursPipe,
    Loading,
  ],
  templateUrl: './reports.html',
  styles: `
    .range {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .range mat-form-field {
      width: 170px;
    }
    .tab {
      padding: 16px 0;
    }
    .panel h2 {
      justify-content: space-between;
    }
    .panel h2 span {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .mt {
      margin-top: 16px;
    }
    .defs {
      margin: 0 0 16px;
    }
    details {
      margin-top: 12px;
    }
    summary {
      cursor: pointer;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
    }
    .table-wrap {
      margin-top: 8px;
      max-height: 360px;
    }
    @media print {
      .range,
      details summary {
        display: none;
      }
      details > .table-wrap {
        display: block;
      }
    }
  `,
})
export class AdminReports {
  private readonly api = inject(Api);
  protected readonly presets = PRESETS;
  protected readonly preset = signal<RangePreset | 'custom'>('90d');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly granularity = signal<Granularity>('week');

  protected readonly data = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.reportData(t)),
  });

  protected readonly range = computed<DateRange>(() => {
    const now = new Date(this.data.value()?.now ?? Date.now());
    const p = this.preset();
    if (p === 'custom' && this.from() && this.to())
      return this.from() <= this.to()
        ? { from: this.from(), to: this.to() }
        : { from: this.to(), to: this.from() };
    return presetRange(p === 'custom' ? '30d' : p, now);
  });
  protected readonly op = computed(() =>
    this.data.value() ? operationalReport(this.data.value()!, this.range()) : null,
  );
  protected readonly fin = computed(() =>
    this.data.value()
      ? financialReport(this.data.value()!, this.range(), this.granularity())
      : null,
  );
  protected readonly statusLabel = (key: string) =>
    STATUS_META[key as keyof typeof STATUS_META]?.label ?? key;

  protected setPreset(p: RangePreset | 'custom'): void {
    this.preset.set(p);
    if (p !== 'custom') {
      const r = presetRange(p, new Date(this.data.value()?.now ?? Date.now()));
      this.from.set(r.from);
      this.to.set(r.to);
      this.granularity.set(
        p === 'today' || p === '7d' || p === '30d' ? 'day' : p === '90d' ? 'week' : 'month',
      );
    }
  }

  protected readonly Math = Math;

  /** Breakdown sections with memoised chart builders (a new function per render would redraw the chart). */
  protected readonly sections = computed(() => {
    const o = this.op();
    if (!o) return [];
    return [
      { title: 'Jobs by status', rows: o.byStatus, file: 'jobs-by-status', status: true },
      {
        title: 'Jobs by repair category',
        rows: o.byCategory,
        file: 'jobs-by-category',
        status: false,
      },
      { title: 'Jobs by phone brand', rows: o.byBrand, file: 'jobs-by-brand', status: false },
      { title: 'Top phone models', rows: o.byModel, file: 'jobs-by-model', status: false },
      { title: 'Jobs by service area', rows: o.byArea, file: 'jobs-by-area', status: false },
      { title: 'Jobs by vendor', rows: o.byVendor, file: 'jobs-by-vendor', status: false },
    ].map((sec) => {
      const top = sec.rows.slice(0, 10);
      const labels = top.map((r) => (sec.status ? this.statusLabel(r.key) : r.label));
      return {
        ...sec,
        height: Math.max(160, top.length * 30 + 40),
        build: (c: ChartColors) =>
          barChart(
            c,
            labels,
            top.map((r) => r.count),
            { label: 'Jobs', horizontal: true },
          ),
      };
    });
  });

  protected readonly volumeChart = computed(() => {
    const s = this.op()!.byDay;
    return (c: ChartColors) => barChart(c, s.keys.map(shortLabel), s.values, { label: 'Requests' });
  });
  protected readonly revenueChart = computed(() => {
    const f = this.fin()!;
    return (c: ChartColors) =>
      lineChart(
        c,
        f.keys.map(shortLabel),
        [
          { label: 'Collected', values: f.collectedSeries },
          { label: 'Commission', values: f.commissionSeries },
          { label: 'Refunds', values: f.refundSeries },
        ],
        { money: true },
      );
  });
  protected readonly methodChart = computed(() => {
    const rows = this.fin()!.byMethod;
    return (c: ChartColors) =>
      barChart(
        c,
        rows.map((r) => r.label),
        rows.map((r) => r.amount),
        { label: 'Collected', horizontal: true, money: true },
      );
  });
  protected readonly categoryChart = computed(() => {
    const rows = this.fin()!.byCategory;
    return (c: ChartColors) =>
      barChart(
        c,
        rows.map((r) => r.name),
        rows.map((r) => r.total),
        { label: 'Repair charges', horizontal: true, money: true },
      );
  });

  protected exportCounts(name: string, rows: CountRow[], labelFn?: (k: string) => string): void {
    this.csv(name, rows, [
      { header: 'Group', value: (r) => (labelFn ? labelFn(r.key) : r.label) },
      { header: 'Jobs', value: (r) => r.count },
      { header: 'Value (PKR)', value: (r) => r.value ?? '' },
    ]);
  }

  protected exportVendors(): void {
    this.csv('vendor-performance', this.op()!.vendors, [
      { header: 'Vendor', value: (r) => r.shopName },
      { header: 'Jobs', value: (r) => r.jobs },
      { header: 'Acceptance rate', value: (r) => pct(r.acceptanceRate) },
      { header: 'Completion rate', value: (r) => pct(r.completionRate) },
      { header: 'Cancellation rate', value: (r) => pct(r.cancellationRate) },
      { header: 'Avg repair hours', value: (r) => r.avgRepairHours?.toFixed(1) },
      { header: 'On-time rate', value: (r) => pct(r.onTimeRate) },
      { header: 'Rating', value: (r) => r.rating?.toFixed(2) },
      { header: 'Reviews', value: (r) => r.reviews },
      { header: 'Complaint rate', value: (r) => pct(r.complaintRate) },
      { header: 'Repeat customers', value: (r) => r.repeatCustomers },
    ]);
  }

  protected exportRevenue(): void {
    const f = this.fin()!;
    const rows = f.keys.map((k, i) => ({
      k,
      c: f.collectedSeries[i],
      m: f.commissionSeries[i],
      r: f.refundSeries[i],
    }));
    this.csv('revenue', rows, [
      { header: `Period (${this.granularity()})`, value: (r) => r.k },
      { header: 'Collected (PKR)', value: (r) => r.c },
      { header: 'Commission (PKR)', value: (r) => r.m },
      { header: 'Refunds (PKR)', value: (r) => r.r },
    ]);
  }

  protected exportVendorMoney(): void {
    this.csv('vendor-earnings', this.fin()!.vendors, [
      { header: 'Vendor', value: (r) => r.shopName },
      { header: 'Earned in period', value: (r) => r.earnedInRange },
      { header: 'Settled in period', value: (r) => r.settledInRange },
      { header: 'Commission (all time)', value: (r) => r.commission },
      { header: 'Cash held (all time)', value: (r) => r.heldByVendor },
      { header: 'Current balance', value: (r) => r.balance },
    ]);
  }

  protected exportCategories(): void {
    this.csv('charges-by-category', this.fin()!.byCategory, [
      { header: 'Category', value: (r) => r.name },
      { header: 'Parts', value: (r) => r.parts },
      { header: 'Labour', value: (r) => r.labor },
      { header: 'Other', value: (r) => r.other },
      { header: 'Total', value: (r) => r.total },
    ]);
  }

  protected exportOutstanding(): void {
    this.csv('outstanding', this.fin()!.outstandingJobs, [
      { header: 'Job', value: (r) => r.job.ref },
      { header: 'Status', value: (r) => r.job.status },
      { header: 'Total', value: (r) => r.f.total },
      { header: 'Outstanding', value: (r) => r.f.outstanding },
    ]);
  }

  private csv<T>(name: string, rows: T[], cols: CsvColumn<T>[]): void {
    const r = this.range();
    downloadCsv(`${name}-${r.from}-to-${r.to}.csv`, toCsv(rows, cols));
  }

  protected print(): void {
    window.print();
  }
}

const pct = (v: number | null) => (v === null ? '' : `${Math.round(v * 100)}%`);
