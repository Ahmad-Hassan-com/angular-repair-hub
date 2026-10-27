import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { TaskView } from '../../core/backend';
import { Session } from '../../core/session';
import { EmptyState, Loading, PkrPipe, StatusBadge } from '../../shared/ui';

/** Pickup and delivery tasks. Agents and vendors see their own; operations sees all (admin=true). */
@Component({
  selector: 'app-tasks',
  imports: [
    RouterLink,
    FormsModule,
    MatButtonToggleModule,
    MatIconModule,
    StatusBadge,
    PkrPipe,
    Loading,
    EmptyState,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>{{ admin() ? 'Pickup and delivery' : 'My pickups and deliveries' }}</h1>
          <p>
            {{
              admin()
                ? 'Every courier visit across the platform.'
                : 'Visits assigned to you. Open a task to start it and verify the customer’s code.'
            }}
          </p>
        </div>
      </header>
      <div class="toolbar-filters">
        <mat-button-toggle-group
          [ngModel]="view()"
          (ngModelChange)="view.set($event)"
          aria-label="Filter tasks"
        >
          <mat-button-toggle value="open">Open</mat-button-toggle>
          <mat-button-toggle value="failed">Failed</mat-button-toggle>
          <mat-button-toggle value="done">History</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      @if (!tasks.hasValue()) {
        <app-loading />
      } @else if (!rows().length) {
        <div class="panel">
          <app-empty icon="local_shipping" title="No tasks" text="Nothing in this list." />
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Task</th>
                <th>When</th>
                <th>Job</th>
                <th>Customer</th>
                <th>Address</th>
                <th>Job status</th>
                @if (admin()) {
                  <th class="num">Fee</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.task.id) {
                <tr class="clickable" [routerLink]="[jobBase(), r.task.jobId]">
                  <td>
                    <span class="kind" [class.pickup]="r.task.kind === 'PICKUP'"
                      ><mat-icon aria-hidden="true">{{
                        r.task.kind === 'PICKUP' ? 'call_received' : 'call_made'
                      }}</mat-icon
                      >{{ r.task.kind === 'PICKUP' ? 'Pickup' : 'Delivery' }}</span
                    >
                    <div class="muted small">
                      {{ r.task.status.replace('_', ' ').toLowerCase()
                      }}{{ r.task.failureReason ? ': ' + r.task.failureReason : '' }}
                    </div>
                  </td>
                  <td>
                    {{ r.task.scheduledDate }}
                    <div class="muted small">{{ r.task.window }}</div>
                  </td>
                  <td>
                    <a class="mono" [routerLink]="[jobBase(), r.task.jobId]">{{ r.jobRef }}</a>
                    <div class="muted small">{{ r.device }}</div>
                  </td>
                  <td>
                    {{ r.customerName }}
                    <div class="small">
                      <a [href]="'tel:' + r.customerPhone" (click)="$event.stopPropagation()">{{
                        r.customerPhone
                      }}</a>
                    </div>
                  </td>
                  <td>
                    {{ r.task.address.line1 }}
                    <div class="muted small">{{ r.area }}</div>
                  </td>
                  <td><app-status [status]="r.jobStatus" /></td>
                  @if (admin()) {
                    <td class="num">{{ r.task.fee | pkr }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted small">
          All times are Pakistan Standard Time. Live GPS tracking is not available.
        </p>
      }
    </div>
  `,
  styles: `
    .kind {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
      color: var(--tone-info-fg);
    }
    .kind.pickup {
      color: var(--tone-progress-fg);
    }
    .kind .mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
  `,
})
export class Tasks {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  readonly admin = input(false);
  protected readonly view = signal<'open' | 'failed' | 'done'>('open');
  protected readonly jobBase = computed(() =>
    this.admin() ? '/admin/jobs' : this.session.role() === 'AGENT' ? '/agent/jobs' : '/vendor/jobs',
  );
  protected readonly tasks = resource({
    params: () => ({ rev: this.api.revision(), admin: this.admin() }),
    loader: ({ params }) => this.api.query((b, t) => (params.admin ? b.allTasks(t) : b.myTasks(t))),
  });
  protected readonly rows = computed(() => {
    const all: TaskView[] = this.tasks.value() ?? [];
    const v = this.view();
    const rows = all.filter((r) =>
      v === 'open'
        ? r.task.status === 'SCHEDULED' || r.task.status === 'IN_PROGRESS'
        : v === 'failed'
          ? r.task.status === 'FAILED'
          : ['COMPLETED', 'RESCHEDULED', 'CANCELLED'].includes(r.task.status),
    );
    return v === 'open'
      ? rows.sort((a, b) =>
          (a.task.scheduledDate + a.task.window).localeCompare(
            b.task.scheduledDate + b.task.window,
          ),
        )
      : rows;
  });
}
