import { Component, computed, inject, resource } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { EmptyState, Loading, PkDatePipe } from '../../shared/ui';

@Component({
  selector: 'app-vendor-reviews',
  imports: [RouterLink, MatIconModule, PkDatePipe, Loading, EmptyState],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Reviews</h1>
          <p>Customers can review a job once their phone is back with them, once per job.</p>
        </div>
      </header>
      @if (!data.hasValue()) {
        <app-loading />
      } @else if (!reviews().length) {
        <div class="panel"><app-empty icon="star" title="No reviews yet" /></div>
      } @else {
        <div class="grid-2">
          <section class="panel summary">
            <div class="big">{{ average().toFixed(1) }}</div>
            <div class="stars">
              {{ '★'.repeat(round(average()))
              }}<span class="off">{{ '★'.repeat(5 - round(average())) }}</span>
            </div>
            <p class="muted">{{ reviews().length }} reviews</p>
            @for (n of [5, 4, 3, 2, 1]; track n) {
              <div class="dist">
                <span>{{ n }}★</span>
                <span class="bar"><span [style.width.%]="share(n)"></span></span>
                <span class="muted small">{{ count(n) }}</span>
              </div>
            }
          </section>
          <section class="stack">
            @for (r of reviews(); track r.id) {
              <article class="panel">
                <div class="row">
                  <span class="stars"
                    >{{ '★'.repeat(r.rating)
                    }}<span class="off">{{ '★'.repeat(5 - r.rating) }}</span></span
                  >
                  <span class="spacer"></span>
                  <span class="muted small">{{ r.at | pkDate: 'date' }}</span>
                </div>
                <p>{{ r.comment || 'No comment.' }}</p>
                <span class="muted small"
                  >{{ r.customerName }} ·
                  <a [routerLink]="['/vendor/jobs', r.jobId]" class="mono">{{ r.jobRef }}</a></span
                >
              </article>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .summary {
      text-align: center;
      align-self: start;
    }
    .big {
      font-size: 3rem;
      font-weight: 700;
    }
    .stars {
      color: #e5a000;
      letter-spacing: 2px;
    }
    .off {
      color: var(--mat-sys-outline-variant);
    }
    .dist {
      display: grid;
      grid-template-columns: 32px 1fr 32px;
      gap: 8px;
      align-items: center;
      margin: 4px 0;
    }
    .bar {
      height: 8px;
      border-radius: 4px;
      background: var(--mat-sys-surface-container-highest);
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: #e5a000;
    }
    article p {
      margin: 8px 0;
    }
  `,
})
export class VendorReviews {
  private readonly api = inject(Api);
  protected readonly data = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.vendorDashboard(t)),
  });
  protected readonly reviews = computed(() => this.data.value()?.reviews ?? []);
  protected readonly average = computed(() => {
    const r = this.reviews();
    return r.length ? r.reduce((s, x) => s + x.rating, 0) / r.length : 0;
  });
  protected readonly round = Math.round;
  protected count(n: number): number {
    return this.reviews().filter((r) => r.rating === n).length;
  }
  protected share(n: number): number {
    return this.reviews().length ? (this.count(n) / this.reviews().length) * 100 : 0;
  }
}
