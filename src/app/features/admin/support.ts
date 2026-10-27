import { Component, inject, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Session } from '../../core/session';
import { Dialogs } from '../../shared/dialogs';
import { EmptyState, Loading, PkDatePipe, Toast } from '../../shared/ui';
import { Support } from '../support/support';

@Component({
  selector: 'app-admin-support',
  imports: [
    RouterLink,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    PkDatePipe,
    Loading,
    EmptyState,
    Support,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Complaints, disputes and reviews</h1>
          <p>
            Reply to customers and vendors, resolve disputes, and moderate reviews under the
            published policy.
          </p>
        </div>
      </header>
      <mat-tab-group animationDuration="0ms">
        <mat-tab label="Complaints and disputes">
          <div class="tab"><app-support [embedded]="true" /></div>
        </mat-tab>
        @if (session.can('reviews.moderate')) {
          <mat-tab label="Reviews">
            <div class="tab">
              <p class="callout small">
                <mat-icon>policy</mat-icon
                ><span
                  ><strong>Moderation policy:</strong> {{ settings.value()?.reviewPolicy }}</span
                >
              </p>
              @if (!reviews.hasValue()) {
                <app-loading />
              } @else {
                @for (r of reviews.value(); track r.id) {
                  <article class="review" [class.hidden]="r.status === 'HIDDEN'">
                    <div class="row">
                      <span class="stars"
                        >{{ '★'.repeat(r.rating)
                        }}<span class="off">{{ '★'.repeat(5 - r.rating) }}</span></span
                      >
                      <strong>{{ r.shopName }}</strong>
                      <span class="muted small"
                        >by {{ r.customerName }} ·
                        <a class="mono" [routerLink]="['/admin/jobs', r.jobId]">{{ r.jobRef }}</a> ·
                        {{ r.at | pkDate: 'date' }}</span
                      >
                      <span class="spacer"></span>
                      @if (r.status === 'HIDDEN') {
                        <span class="tone neutral">hidden</span>
                        <button mat-button type="button" (click)="moderate(r.id, 'PUBLISHED')">
                          Restore
                        </button>
                      } @else {
                        <button mat-button type="button" (click)="moderate(r.id, 'HIDDEN')">
                          Hide
                        </button>
                      }
                    </div>
                    <p>{{ r.comment || 'No comment.' }}</p>
                    @if (r.moderationNote) {
                      <p class="muted small">Moderation note: {{ r.moderationNote }}</p>
                    }
                  </article>
                } @empty {
                  <app-empty icon="star" title="No reviews yet" />
                }
              }
            </div>
          </mat-tab>
        }
      </mat-tab-group>
    </div>
  `,
  styles: `
    .tab {
      padding: 16px 0;
    }
    .callout {
      margin-bottom: 12px;
    }
    .review {
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 8px;
    }
    .review.hidden {
      opacity: 0.7;
    }
    .review p {
      margin: 6px 0 0;
    }
    .stars {
      color: #e5a000;
    }
    .off {
      color: var(--mat-sys-outline-variant);
    }
  `,
})
export class AdminSupport {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly dialogs = inject(Dialogs);
  protected readonly session = inject(Session);
  protected readonly busy = signal(false);
  protected readonly settings = resource({ loader: () => this.api.query((b, t) => b.settings(t)) });
  protected readonly reviews = resource({
    params: () => ({ rev: this.api.revision(), ok: this.session.can('reviews.moderate') }),
    loader: ({ params }) =>
      params.ok ? this.api.query((b, t) => b.allReviews(t)) : Promise.resolve([]),
  });

  protected async moderate(id: string, status: 'PUBLISHED' | 'HIDDEN'): Promise<void> {
    let note = '';
    if (status === 'HIDDEN') {
      const n = await this.dialogs.prompt(
        'Hide this review?',
        'Record which policy rule it breaks. The rating stops counting towards the vendor score.',
        'Policy reason',
        'Hide review',
      );
      if (n === null) return;
      note = n;
    }
    try {
      await this.api.mutate((b, t) => b.moderateReview(t, id, status, note));
      this.toast.ok(status === 'HIDDEN' ? 'Review hidden.' : 'Review restored.');
    } catch (e) {
      this.toast.error(e);
    }
  }
}
