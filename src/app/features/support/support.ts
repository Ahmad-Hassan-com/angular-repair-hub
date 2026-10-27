import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { ComplaintStatus } from '../../core/models';
import { Session } from '../../core/session';
import { EmptyState, Loading, PkDatePipe, Toast } from '../../shared/ui';

/** Complaints and disputes. Customers and vendors see their own threads; staff see and resolve all. */
@Component({
  selector: 'app-support',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    PkDatePipe,
    Loading,
    EmptyState,
  ],
  template: `
    <div [class.page]="!embedded()">
      @if (!embedded()) {
        <header class="page-header">
          <div>
            <h1>Support</h1>
            <p>
              Raise a complaint or follow up on one. To dispute a delivered repair, open the job and
              choose "Raise a dispute".
            </p>
          </div>
        </header>
      }
      <div class="stack">
        @if (!staff()) {
          <section class="panel">
            <h2><mat-icon>edit</mat-icon>New complaint</h2>
            <form [formGroup]="form" (ngSubmit)="raise()" class="form-grid">
              <mat-form-field>
                <mat-label>Related job (optional)</mat-label>
                <mat-select formControlName="jobId">
                  <mat-option value="">Not about a specific job</mat-option>
                  @for (j of jobs.value()?.items ?? []; track j.id) {
                    <mat-option [value]="j.id"
                      >{{ j.ref }} · {{ j.brand }} {{ j.model }}</mat-option
                    >
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Subject</mat-label>
                <input matInput formControlName="subject" maxlength="120" />
                <mat-error>At least 5 characters.</mat-error>
              </mat-form-field>
              <mat-form-field class="full">
                <mat-label>What happened?</mat-label>
                <textarea matInput rows="3" formControlName="body" maxlength="2000"></textarea>
                <mat-error>At least 10 characters.</mat-error>
              </mat-form-field>
              <div class="full">
                <button mat-flat-button type="submit" [disabled]="busy()">Send to support</button>
              </div>
            </form>
          </section>
        }

        <section [class.panel]="!embedded()">
          @if (!embedded()) {
            <h2><mat-icon>forum</mat-icon>{{ staff() ? 'All complaints' : 'Your complaints' }}</h2>
          }
          @if (staff()) {
            <div class="toolbar-filters">
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Status</mat-label>
                <mat-select [ngModel]="filter()" (ngModelChange)="filter.set($event)">
                  <mat-option value="">All</mat-option>
                  <mat-option value="OPEN">Open</mat-option>
                  <mat-option value="IN_REVIEW">In review</mat-option>
                  <mat-option value="RESOLVED">Resolved</mat-option>
                  <mat-option value="REJECTED">Rejected</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
          }
          @if (!complaints.hasValue()) {
            <app-loading />
          } @else if (!visible().length) {
            <app-empty
              icon="sentiment_satisfied"
              title="No complaints"
              text="Nothing here right now."
            />
          } @else {
            <mat-accordion multi>
              @for (c of visible(); track c.id) {
                <mat-expansion-panel>
                  <mat-expansion-panel-header>
                    <mat-panel-title>
                      @if (c.isDispute) {
                        <span class="tone danger">dispute</span>
                      }
                      {{ c.subject }}
                    </mat-panel-title>
                    <mat-panel-description>
                      <span class="tone" [class]="tone(c.status)">{{
                        c.status.replace('_', ' ').toLowerCase()
                      }}</span>
                      <span class="hide-sm">{{ c.updatedAt | pkDate }}</span>
                    </mat-panel-description>
                  </mat-expansion-panel-header>
                  <p class="muted small">
                    Raised by {{ c.raisedByName }} on {{ c.createdAt | pkDate }}
                    @if (c.jobRef) {
                      · job <a [routerLink]="[jobBase(), c.jobId]" class="mono">{{ c.jobRef }}</a>
                    }
                  </p>
                  <ol class="thread">
                    @for (m of c.messages; track m.id) {
                      <li [class.mine]="m.authorId === session.user()?.id">
                        <span class="muted small">{{ $any(m).author }} · {{ m.at | pkDate }}</span>
                        <p>{{ m.body }}</p>
                      </li>
                    }
                  </ol>
                  @if (c.resolution) {
                    <p class="callout success">
                      <mat-icon>check</mat-icon><span>Resolution: {{ c.resolution }}</span>
                    </p>
                  }
                  @if (c.status !== 'RESOLVED' && c.status !== 'REJECTED') {
                    <div class="reply">
                      <mat-form-field class="full-width" subscriptSizing="dynamic">
                        <mat-label>Reply</mat-label>
                        <textarea
                          matInput
                          rows="2"
                          [(ngModel)]="replies[c.id]"
                          maxlength="2000"
                        ></textarea>
                      </mat-form-field>
                      <div class="row">
                        <button
                          mat-stroked-button
                          type="button"
                          (click)="reply(c.id)"
                          [disabled]="busy() || (replies[c.id] ?? '').trim().length < 2"
                        >
                          Send reply
                        </button>
                        @if (staff()) {
                          <button
                            mat-flat-button
                            type="button"
                            (click)="reply(c.id, 'RESOLVED')"
                            [disabled]="busy() || (replies[c.id] ?? '').trim().length < 2"
                          >
                            Reply and resolve
                          </button>
                          <button
                            mat-button
                            type="button"
                            (click)="reply(c.id, 'REJECTED')"
                            [disabled]="busy() || (replies[c.id] ?? '').trim().length < 2"
                          >
                            Reject
                          </button>
                        }
                      </div>
                      @if (staff() && c.isDispute) {
                        <p class="muted small">To refund or close a disputed job, open the job.</p>
                      }
                    </div>
                  }
                </mat-expansion-panel>
              }
            </mat-accordion>
          }
        </section>
      </div>
    </div>
  `,
  styles: `
    mat-panel-title {
      gap: 8px;
      align-items: center;
    }
    mat-panel-description {
      justify-content: flex-end;
      gap: 12px;
    }
    .thread {
      list-style: none;
      padding: 0;
      margin: 0 0 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .thread li {
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container);
      max-width: 85%;
    }
    .thread li.mine {
      align-self: flex-end;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .thread p {
      margin: 4px 0 0;
    }
    .callout {
      margin: 8px 0;
    }
    @media (max-width: 599px) {
      .hide-sm {
        display: none;
      }
    }
  `,
})
export class Support {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly session = inject(Session);
  /** Set when rendered inside the admin "Complaints & reviews" page. */
  readonly embedded = input(false);

  protected readonly staff = computed(
    () => this.session.role() === 'SUPER_ADMIN' || this.session.role() === 'STAFF',
  );
  protected readonly jobBase = computed(() =>
    this.staff()
      ? '/admin/jobs'
      : this.session.role() === 'VENDOR'
        ? '/vendor/jobs'
        : '/customer/jobs',
  );
  protected readonly complaints = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.listComplaints(t)),
  });
  protected readonly jobs = resource({
    loader: () => this.api.query((b, t) => b.listJobs(t, { pageSize: 100 })),
  });
  protected readonly filter = signal<ComplaintStatus | ''>('');
  protected readonly visible = computed(() =>
    (this.complaints.value() ?? []).filter((c) => !this.filter() || c.status === this.filter()),
  );
  protected readonly busy = signal(false);
  protected replies: Record<string, string> = {};

  protected readonly form = inject(FormBuilder).nonNullable.group({
    jobId: [''],
    subject: ['', [Validators.required, Validators.minLength(5)]],
    body: ['', [Validators.required, Validators.minLength(10)]],
  });

  protected tone(s: ComplaintStatus): string {
    return { OPEN: 'warning', IN_REVIEW: 'info', RESOLVED: 'success', REJECTED: 'neutral' }[s];
  }

  protected async raise(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.raiseComplaint(t, { ...v, jobId: v.jobId || undefined }));
      this.form.reset();
      this.toast.ok('Sent. Our support team will get back to you.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async reply(id: string, status?: ComplaintStatus): Promise<void> {
    const body = this.replies[id] ?? '';
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) =>
        b.replyToComplaint(t, id, body, status, status ? body : undefined),
      );
      this.replies[id] = '';
      this.toast.ok(status ? `Marked ${status.toLowerCase()}.` : 'Reply sent.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
