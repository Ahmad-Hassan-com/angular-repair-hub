import { Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { JobStatus } from '../../core/models';
import { Session } from '../../core/session';
import { ACTIVE_STATUSES, STAGES, STATUS_META } from '../../core/workflow';
import { EmptyState, Loading, PkDatePipe, PkrPipe, StatusBadge } from '../../shared/ui';

@Component({
  selector: 'app-my-repairs',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    StatusBadge,
    PkrPipe,
    PkDatePipe,
    Loading,
    EmptyState,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Hi {{ firstName() }}</h1>
          <p>Track your repairs and respond to quotations.</p>
        </div>
        <a mat-flat-button routerLink="/customer/new"><mat-icon>add</mat-icon>Request a repair</a>
      </header>

      @if (session.user() && !session.user()!.phoneVerified) {
        <p class="callout warning">
          <mat-icon>sms</mat-icon>
          <span
            >Verify your mobile number so couriers can reach you.
            <a routerLink="/customer/profile">Verify now</a></span
          >
        </p>
      }

      @if (jobs.isLoading() && !jobs.hasValue()) {
        <div class="panel"><app-loading /></div>
      } @else if (jobs.error()) {
        <app-empty icon="error" title="Couldn't load your repairs" text="Please try again.">
          <button mat-stroked-button type="button" (click)="jobs.reload()">Retry</button>
        </app-empty>
      } @else if (!all().length) {
        <div class="panel">
          <app-empty
            icon="smartphone"
            title="No repairs yet"
            text="Tell us what's wrong with your phone and we'll arrange pickup."
          >
            <a mat-flat-button routerLink="/customer/new">Request your first repair</a>
          </app-empty>
        </div>
      } @else {
        @if (needsAction().length) {
          <h2 class="section">Needs your attention</h2>
          <div class="cards">
            @for (j of needsAction(); track j.id) {
              <a class="card plain attention" [routerLink]="['/customer/jobs', j.id]">
                <div class="row">
                  <span class="mono">{{ j.ref }}</span
                  ><app-status [status]="j.status" audience="customer" />
                </div>
                <strong>{{ j.brand }} {{ j.model }}</strong>
                <span class="muted">{{ j.category }}</span>
                <span class="cta"
                  >{{
                    j.status === 'AWAITING_APPROVAL'
                      ? 'Review quotation'
                      : 'Pay ' + (j.outstanding | pkr)
                  }}
                  <mat-icon>arrow_forward</mat-icon></span
                >
              </a>
            }
          </div>
        }

        @if (active().length) {
          <h2 class="section">In progress</h2>
          <div class="cards">
            @for (j of active(); track j.id) {
              <a class="card plain" [routerLink]="['/customer/jobs', j.id]">
                <div class="row">
                  <span class="mono">{{ j.ref }}</span
                  ><app-status [status]="j.status" audience="customer" />
                </div>
                <strong>{{ j.brand }} {{ j.model }}</strong>
                <span class="muted">{{ j.category }} · {{ j.createdAt | pkDate: 'date' }}</span>
                <div class="progress" [attr.aria-label]="'Stage: ' + stages[stage(j.status)]">
                  @for (s of stages; track s; let i = $index) {
                    <span [class.on]="i <= stage(j.status)"></span>
                  }
                </div>
                <span class="muted small">{{ stages[stage(j.status)] }}</span>
              </a>
            }
          </div>
        }

        @if (past().length) {
          <h2 class="section">History</h2>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Device</th>
                  <th>Status</th>
                  <th class="num">Total</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                @for (j of past(); track j.id) {
                  <tr class="clickable" [routerLink]="['/customer/jobs', j.id]">
                    <td>
                      <a class="mono" [routerLink]="['/customer/jobs', j.id]">{{ j.ref }}</a>
                    </td>
                    <td>
                      {{ j.brand }} {{ j.model }}
                      <div class="muted small">{{ j.category }}</div>
                    </td>
                    <td><app-status [status]="j.status" audience="customer" /></td>
                    <td class="num">{{ j.total ? (j.total | pkr) : '—' }}</td>
                    <td class="small">{{ j.createdAt | pkDate: 'date' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .section {
      font: var(--mat-sys-title-medium);
      font-weight: 600;
      margin: 24px 0 12px;
    }
    .callout {
      margin-bottom: 16px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 16px;
      border-radius: 16px;
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
      color: inherit;
      text-decoration: none;
    }
    .card:hover {
      border-color: var(--mat-sys-primary);
    }
    .card .row {
      justify-content: space-between;
    }
    .attention {
      border-color: var(--tone-warning-fg);
      background: var(--tone-warning-bg);
    }
    .cta {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
      color: var(--tone-warning-fg);
    }
    .progress {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
      margin-top: 6px;
    }
    .progress span {
      height: 5px;
      border-radius: 3px;
      background: var(--mat-sys-surface-container-highest);
    }
    .progress span.on {
      background: var(--mat-sys-primary);
    }
  `,
})
export class MyRepairs {
  private readonly api = inject(Api);
  protected readonly session = inject(Session);
  protected readonly stages = STAGES;
  protected readonly jobs = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.listJobs(t, { pageSize: 100, sort: 'updated' })),
  });
  protected readonly all = computed(() => this.jobs.value()?.items ?? []);
  protected readonly needsAction = computed(() =>
    this.all().filter(
      (j) =>
        j.status === 'AWAITING_APPROVAL' ||
        (j.outstanding > 0 && ['DELIVERED', 'RETURNED_WITHOUT_REPAIR'].includes(j.status)),
    ),
  );
  protected readonly active = computed(() =>
    this.all().filter(
      (j) =>
        ACTIVE_STATUSES.includes(j.status) &&
        !this.needsAction().includes(j) &&
        !['DELIVERED', 'DISPUTED'].includes(j.status),
    ),
  );
  protected readonly past = computed(() =>
    this.all().filter((j) => !this.needsAction().includes(j) && !this.active().includes(j)),
  );
  protected readonly firstName = computed(() => this.session.user()?.name.split(' ')[0] ?? '');

  protected stage(s: JobStatus): number {
    return STATUS_META[s].stage;
  }
}
