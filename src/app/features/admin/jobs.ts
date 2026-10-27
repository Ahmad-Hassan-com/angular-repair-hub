import { Component, effect, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { Api } from '../../core/api';
import { JobQuery } from '../../core/backend';
import { downloadCsv, pkDay, toCsv } from '../../core/reports';
import { ALL_STATUSES, STATUS_META } from '../../core/workflow';
import { EmptyState, Loading, Toast } from '../../shared/ui';
import { JobTable } from '../jobs/job-table';

@Component({
  selector: 'app-admin-jobs',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    JobTable,
    Loading,
    EmptyState,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Repair jobs</h1>
          <p>
            Search, filter and open any job. Open a job to assign, reassign, cancel or refund it.
          </p>
        </div>
        <button mat-stroked-button type="button" (click)="exportCsv()">
          <mat-icon>download</mat-icon>Export CSV
        </button>
      </header>
      <div class="toolbar-filters">
        <mat-form-field class="search" subscriptSizing="dynamic">
          <mat-label>Search</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            [ngModel]="q().search"
            (ngModelChange)="set({ search: $event })"
            placeholder="Job ref, customer, vendor, model"
          />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Status</mat-label>
          <mat-select [ngModel]="q().status" (ngModelChange)="set({ status: $event })">
            <mat-option value="">All statuses</mat-option>
            <mat-option value="ACTIVE">Active (any)</mat-option>
            <mat-option value="OVERDUE">Overdue</mat-option>
            @for (s of statuses; track s) {
              <mat-option [value]="s">{{ meta[s].label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Vendor</mat-label>
          <mat-select [ngModel]="q().vendorId" (ngModelChange)="set({ vendorId: $event })">
            <mat-option value="">All vendors</mat-option>
            @for (v of vendors.value() ?? []; track v.id) {
              <mat-option [value]="v.id">{{ v.shopName }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Area</mat-label>
          <mat-select [ngModel]="q().areaId" (ngModelChange)="set({ areaId: $event })">
            <mat-option value="">All areas</mat-option>
            @for (a of catalog.value()?.areas ?? []; track a.id) {
              <mat-option [value]="a.id">{{ a.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Sort</mat-label>
          <mat-select [ngModel]="q().sort" (ngModelChange)="set({ sort: $event })">
            <mat-option value="newest">Newest first</mat-option>
            <mat-option value="oldest">Oldest first</mat-option>
            <mat-option value="updated">Recently updated</mat-option>
            <mat-option value="total">Highest value</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      @if (!jobs.hasValue()) {
        <app-loading />
      } @else if (!jobs.value()!.items.length) {
        <div class="panel">
          <app-empty icon="search_off" title="No matching jobs" text="Try a different filter." />
        </div>
      } @else {
        <app-job-table
          [rows]="jobs.value()!.items"
          base="/admin/jobs"
          [showCustomer]="true"
          [showVendor]="true"
        />
        <mat-paginator
          [length]="jobs.value()!.total"
          [pageIndex]="(q().page ?? 1) - 1"
          [pageSize]="q().pageSize"
          [pageSizeOptions]="[10, 25, 50]"
          (page)="onPage($event)"
        />
      }
    </div>
  `,
})
export class AdminJobs {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  /** Optional ?status= deep link from the overview. */
  readonly status = input<string>();

  protected readonly statuses = ALL_STATUSES;
  protected readonly meta = STATUS_META;
  protected readonly q = signal<JobQuery>({
    search: '',
    status: '',
    vendorId: '',
    areaId: '',
    sort: 'newest',
    page: 1,
    pageSize: 25,
  });
  protected readonly catalog = resource({ loader: () => this.api.query((b) => b.catalog()) });
  protected readonly vendors = resource({
    loader: () => this.api.query((b, t) => b.reportData(t).vendors).catch(() => []),
  });
  protected readonly jobs = resource({
    params: () => ({ q: this.q(), rev: this.api.revision() }),
    loader: ({ params }) => this.api.query((b, t) => b.listJobs(t, params.q)),
  });

  constructor() {
    effect(() => {
      const s = this.status();
      if (s) this.q.update((q) => ({ ...q, status: s as JobQuery['status'], page: 1 }));
    });
  }

  protected set(patch: Partial<JobQuery>): void {
    this.q.update((q) => ({ ...q, ...patch, page: 1 }));
  }

  protected onPage(e: PageEvent): void {
    this.q.update((q) => ({ ...q, page: e.pageIndex + 1, pageSize: e.pageSize }));
  }

  protected async exportCsv(): Promise<void> {
    try {
      const all = await this.api.query((b, t) =>
        b.listJobs(t, { ...this.q(), page: 1, pageSize: 100_000 }),
      );
      const csv = toCsv(all.items, [
        { header: 'Ref', value: (r) => r.ref },
        { header: 'Status', value: (r) => STATUS_META[r.status].label },
        { header: 'Brand', value: (r) => r.brand },
        { header: 'Model', value: (r) => r.model },
        { header: 'Category', value: (r) => r.category },
        { header: 'Area', value: (r) => r.area },
        { header: 'Customer', value: (r) => r.customerName },
        { header: 'Vendor', value: (r) => r.vendorName },
        { header: 'Total (PKR)', value: (r) => r.total },
        { header: 'Outstanding (PKR)', value: (r) => r.outstanding },
        { header: 'Created (PKT)', value: (r) => pkDay(r.createdAt) },
        { header: 'Overdue', value: (r) => (r.overdue ? 'yes' : '') },
      ]);
      downloadCsv(`repair-jobs-${pkDay(new Date())}.csv`, csv);
    } catch (e) {
      this.toast.error(e);
    }
  }
}
