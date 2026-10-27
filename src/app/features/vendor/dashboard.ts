import { Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { ACTIVE_STATUSES } from '../../core/workflow';
import { EmptyState, HoursPipe, KpiTile, Loading, PctPipe, PkrPipe } from '../../shared/ui';
import { JobTable } from '../jobs/job-table';

@Component({
  selector: 'app-vendor-dashboard',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    KpiTile,
    PkrPipe,
    PctPipe,
    HoursPipe,
    Loading,
    EmptyState,
    JobTable,
  ],
  template: `
    <div class="page">
      @if (!data.hasValue()) {
        <div class="panel"><app-loading /></div>
      } @else {
        @let d = data.value()!;
        <header class="page-header">
          <div>
            <h1>{{ d.vendor.shopName }}</h1>
            <p>Your jobs, performance and earnings.</p>
          </div>
          @if (d.status === 'APPROVED') {
            <a mat-flat-button routerLink="/vendor/marketplace"
              ><mat-icon>work</mat-icon>{{ d.available }} available job{{
                d.available === 1 ? '' : 's'
              }}</a
            >
          }
        </header>

        @switch (d.status) {
          @case ('PENDING') {
            <div class="panel">
              <app-empty
                icon="hourglass_top"
                title="Your application is being reviewed"
                text="We usually review new shops within one working day. You'll get a notification once you're approved, and then you can start accepting jobs."
              >
                <a mat-stroked-button routerLink="/vendor/settings">Review your business details</a>
              </app-empty>
            </div>
          }
          @case ('REJECTED') {
            <p class="callout danger">
              <mat-icon>block</mat-icon
              ><span
                >Your application was not approved: {{ d.vendor.statusReason }}. Contact support to
                reapply.</span
              >
            </p>
          }
          @case ('SUSPENDED') {
            <p class="callout danger">
              <mat-icon>block</mat-icon
              ><span
                >Your account is suspended: {{ d.vendor.statusReason }}. You can finish viewing
                existing jobs but can't take new ones.</span
              >
            </p>
          }
        }

        @if (d.status === 'APPROVED' && !d.vendor.available) {
          <p class="callout warning">
            <mat-icon>pause_circle</mat-icon
            ><span
              >You're not accepting new jobs.
              <a routerLink="/vendor/settings">Change availability</a></span
            >
          </p>
        }

        @if (d.status !== 'PENDING') {
          <div class="kpis">
            <app-kpi label="Available jobs" [value]="d.available" icon="work" />
            <app-kpi label="Awaiting pickup" [value]="d.accepted" icon="event" />
            <app-kpi label="Active repairs" [value]="d.activeRepairs" icon="build" />
            <app-kpi label="Completed" [value]="d.completed" icon="task_alt" />
            <app-kpi
              label="Balance"
              [value]="d.balance.balance | pkr"
              [hint]="d.balance.balance >= 0 ? 'Platform owes you' : 'You owe the platform'"
              icon="account_balance_wallet"
              [alert]="d.balance.balance < 0"
            />
            <app-kpi
              label="Pending earnings"
              [value]="d.balance.pending | pkr"
              hint="On jobs not yet paid"
              icon="schedule"
            />
          </div>

          <div class="grid-2">
            <section class="panel">
              <h2><mat-icon>speed</mat-icon>Performance</h2>
              <dl class="facts">
                <dt>Customer rating</dt>
                <dd>
                  {{
                    d.performance.rating
                      ? d.performance.rating.toFixed(1) + ' ★ (' + d.performance.reviewCount + ')'
                      : 'No reviews yet'
                  }}
                </dd>
                <dt>Completion rate</dt>
                <dd>{{ d.performance.completionRate | pct }}</dd>
                <dt>On-time delivery</dt>
                <dd>{{ d.performance.onTimeRate | pct }}</dd>
                <dt>Average repair time</dt>
                <dd>{{ d.performance.avgRepairHours | hours }}</dd>
                <dt>Acceptance rate (assigned)</dt>
                <dd>{{ d.performance.acceptanceRate | pct }}</dd>
                <dt>Cancellation rate</dt>
                <dd>{{ d.performance.cancellationRate | pct }}</dd>
                <dt>Complaint rate</dt>
                <dd>{{ d.performance.complaintRate | pct }}</dd>
                <dt>Repeat customers</dt>
                <dd>{{ d.performance.repeatCustomers }}</dd>
              </dl>
              <p class="muted small">
                Calculated from your actual jobs. "—" means there isn't enough data yet.
              </p>
            </section>
            <section class="panel">
              <h2><mat-icon>format_quote</mat-icon>Latest reviews</h2>
              @for (r of d.reviews.slice(0, 3); track r.id) {
                <blockquote>
                  <div class="stars" [attr.aria-label]="r.rating + ' out of 5'">
                    {{ '★'.repeat(r.rating)
                    }}<span class="off">{{ '★'.repeat(5 - r.rating) }}</span>
                  </div>
                  @if (r.comment) {
                    <p>“{{ r.comment }}”</p>
                  }
                  <footer class="muted small">{{ r.customerName }} · {{ r.jobRef }}</footer>
                </blockquote>
              } @empty {
                <p class="muted">Reviews appear after customers receive their phones.</p>
              }
              <a mat-button routerLink="/vendor/reviews">All reviews</a>
            </section>
          </div>

          <section class="panel mt">
            <div class="row head">
              <h2><mat-icon>build</mat-icon>Jobs in progress</h2>
              <a mat-button routerLink="/vendor/jobs">All jobs</a>
            </div>
            @if (active().length) {
              <app-job-table
                [rows]="active()"
                base="/vendor/jobs"
                [showCustomer]="true"
                dateLabel="Updated"
              />
            } @else {
              <p class="muted">No jobs in progress.</p>
            }
          </section>
        }
      }
    </div>
  `,
  styles: `
    .callout {
      margin-bottom: 16px;
    }
    blockquote {
      margin: 0 0 12px;
      padding: 0 0 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    blockquote p {
      margin: 4px 0;
    }
    .stars {
      color: #e5a000;
      letter-spacing: 2px;
    }
    .off {
      color: var(--mat-sys-outline-variant);
    }
    .mt {
      margin-top: 16px;
    }
    .head {
      justify-content: space-between;
    }
  `,
})
export class VendorDashboard {
  private readonly api = inject(Api);
  protected readonly data = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.vendorDashboard(t)),
  });
  protected readonly jobs = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () =>
      this.api.query((b, t) => b.listJobs(t, { status: 'ACTIVE', sort: 'updated', pageSize: 8 })),
  });
  protected readonly active = computed(() =>
    (this.jobs.value()?.items ?? []).filter((j) => ACTIVE_STATUSES.includes(j.status)),
  );
}
