import { Component, inject, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { JobSummary } from '../../core/backend';
import { EmptyState, Loading, PkDatePipe, Toast } from '../../shared/ui';

/** Jobs this shop is eligible for. Accepting is first-come, first-served and race-safe on the backend. */
@Component({
  selector: 'app-marketplace',
  imports: [RouterLink, MatButtonModule, MatIconModule, PkDatePipe, Loading, EmptyState],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Available jobs</h1>
          <p>
            Requests in your service areas, for brands and repairs you handle. Customer details are
            shared once you accept.
          </p>
        </div>
        <button mat-stroked-button type="button" (click)="jobs.reload()">
          <mat-icon>refresh</mat-icon>Refresh
        </button>
      </header>
      @if (!jobs.hasValue()) {
        <div class="panel"><app-loading /></div>
      } @else if (!(jobs.value() ?? []).length) {
        <div class="panel">
          <app-empty
            icon="work_off"
            title="No jobs available right now"
            text="New requests that match your services appear here, and you'll get a notification."
          />
        </div>
      } @else {
        <div class="cards">
          @for (j of jobs.value(); track j.id) {
            <article class="job">
              <header class="row">
                <span class="mono">{{ j.ref }}</span>
                @if (j.offeredToMe) {
                  <span class="tone info">Assigned to you</span>
                }
                <span class="spacer"></span>
                <span class="muted small">{{ j.createdAt | pkDate }}</span>
              </header>
              <h2>{{ j.brand }} {{ j.model }}</h2>
              <p class="cat"><mat-icon aria-hidden="true">build</mat-icon>{{ j.category }}</p>
              <dl class="facts">
                <dt>Area</dt>
                <dd>{{ j.area }}</dd>
                <dt>Pickup</dt>
                <dd>{{ j.preferredPickupDate }}</dd>
              </dl>
              <div class="row actions">
                <a mat-button [routerLink]="['/vendor/jobs', j.id]">Details</a>
                <span class="spacer"></span>
                <button
                  mat-flat-button
                  type="button"
                  (click)="accept(j)"
                  [disabled]="busy() === j.id"
                >
                  <mat-icon>handshake</mat-icon>{{ busy() === j.id ? 'Accepting…' : 'Accept' }}
                </button>
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .job {
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      font-weight: 600;
      margin: 0;
    }
    .cat {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      color: var(--mat-sys-primary);
    }
    .actions {
      margin-top: auto;
    }
  `,
})
export class Marketplace {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly router = inject(Router);
  protected readonly busy = signal<string | null>(null);
  protected readonly jobs = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.marketplace(t)),
  });

  protected async accept(j: JobSummary): Promise<void> {
    this.busy.set(j.id);
    try {
      await this.api.mutate((b, t) => b.acceptJob(t, j.id));
      this.toast.ok(`${j.ref} is yours. Schedule the pickup next.`);
      await this.router.navigate(['/vendor/jobs', j.id]);
    } catch (e) {
      // e.g. "Sorry, this job has already been taken by another vendor."
      this.toast.error(e);
      this.jobs.reload();
    } finally {
      this.busy.set(null);
    }
  }
}
