import { Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { Api } from '../../core/api';
import { JobQuery } from '../../core/backend';
import { EmptyState, Loading } from '../../shared/ui';
import { JobTable } from '../jobs/job-table';

@Component({
  selector: 'app-my-jobs',
  imports: [
    FormsModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
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
          <h1>My jobs</h1>
          <p>Every job you've accepted.</p>
        </div>
      </header>
      <div class="toolbar-filters">
        <mat-button-toggle-group
          [ngModel]="status()"
          (ngModelChange)="status.set($event); page.set(1)"
          aria-label="Filter"
        >
          <mat-button-toggle value="ACTIVE">Active</mat-button-toggle>
          <mat-button-toggle value="OVERDUE">Overdue</mat-button-toggle>
          <mat-button-toggle value="">All</mat-button-toggle>
        </mat-button-toggle-group>
        <mat-form-field class="search" subscriptSizing="dynamic">
          <mat-label>Search</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            [ngModel]="search()"
            (ngModelChange)="search.set($event); page.set(1)"
            placeholder="Job, customer, model"
          />
        </mat-form-field>
      </div>
      @if (!jobs.hasValue()) {
        <app-loading />
      } @else if (!jobs.value()!.items.length) {
        <div class="panel">
          <app-empty
            icon="build"
            title="No jobs here"
            text="Accept jobs from the Available jobs page."
          />
        </div>
      } @else {
        <app-job-table
          [rows]="jobs.value()!.items"
          base="/vendor/jobs"
          [showCustomer]="true"
          dateLabel="Updated"
        />
        <mat-paginator
          [length]="jobs.value()!.total"
          [pageIndex]="page() - 1"
          [pageSize]="15"
          [hidePageSize]="true"
          (page)="onPage($event)"
        />
      }
    </div>
  `,
})
export class MyJobs {
  private readonly api = inject(Api);
  protected readonly status = signal<JobQuery['status']>('ACTIVE');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly jobs = resource({
    params: () => ({
      rev: this.api.revision(),
      status: this.status(),
      search: this.search(),
      page: this.page(),
    }),
    loader: ({ params }) =>
      this.api.query((b, t) =>
        b.listJobs(t, {
          status: params.status,
          search: params.search,
          page: params.page,
          pageSize: 15,
          sort: 'updated',
        }),
      ),
  });

  protected onPage(e: PageEvent): void {
    this.page.set(e.pageIndex + 1);
  }
}
