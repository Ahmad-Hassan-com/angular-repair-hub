import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, Injectable, input, Pipe, PipeTransform } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { errorMessage } from '../core/api';
import { formatPkr } from '../core/finance';
import { JobStatus } from '../core/models';
import { STATUS_META, Tone } from '../core/workflow';

@Pipe({ name: 'pkr' })
export class PkrPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : formatPkr(value);
  }
}

/** Dates are shown in Pakistan time regardless of the viewer's device. */
@Pipe({ name: 'pkDate' })
export class PkDatePipe implements PipeTransform {
  private readonly date = new DatePipe('en-PK');
  transform(
    value: string | null | undefined,
    format: 'short' | 'date' | 'time' | 'long' = 'short',
  ): string {
    if (!value) return '—';
    const f = {
      short: 'd MMM, h:mm a',
      date: 'd MMM y',
      time: 'h:mm a',
      long: 'EEE d MMM y, h:mm a',
    }[format];
    return this.date.transform(value, f, '+0500') ?? '—';
  }
}

@Pipe({ name: 'pct' })
export class PctPipe implements PipeTransform {
  private readonly num = new DecimalPipe('en-PK');
  transform(value: number | null | undefined): string {
    return value === null || value === undefined
      ? '—'
      : `${this.num.transform(value * 100, '1.0-0')}%`;
  }
}

/** "3.5 h" or "2.1 days". */
@Pipe({ name: 'hours' })
export class HoursPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return value >= 48 ? `${(value / 24).toFixed(1)} days` : `${value.toFixed(1)} h`;
  }
}

@Component({
  selector: 'app-status',
  imports: [MatIconModule],
  template: `<span class="tone" [class]="meta().tone"
    ><mat-icon aria-hidden="true">{{ meta().icon }}</mat-icon
    >{{ label() }}</span
  >`,
})
export class StatusBadge {
  readonly status = input.required<JobStatus>();
  /** Customers see "Awaiting your approval"; everyone else sees a neutral label. */
  readonly audience = input<'customer' | 'staff'>('staff');
  protected readonly meta = computed(() => STATUS_META[this.status()]);
  protected readonly label = computed(() =>
    this.status() === 'AWAITING_APPROVAL' && this.audience() === 'staff'
      ? 'Awaiting customer approval'
      : this.meta().label,
  );
}

@Component({
  selector: 'app-tone',
  template: `<span class="tone" [class]="tone()"><ng-content /></span>`,
})
export class ToneChip {
  readonly tone = input<Tone>('neutral');
}

@Component({
  selector: 'app-kpi',
  imports: [MatIconModule],
  template: `
    <div class="kpi" [class.alert]="alert()">
      <div class="top">
        <span class="label">{{ label() }}</span>
        @if (icon()) {
          <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
        }
      </div>
      <div class="value">{{ value() }}</div>
      @if (hint()) {
        <div class="hint">{{ hint() }}</div>
      }
    </div>
  `,
  styles: `
    .kpi {
      height: 100%;
      box-sizing: border-box;
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 14px;
      padding: 14px 16px;
    }
    .kpi.alert {
      border-color: var(--tone-warning-fg);
      background: var(--tone-warning-bg);
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .label {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
    }
    .top .mat-icon {
      color: var(--mat-sys-primary);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .value {
      font: var(--mat-sys-headline-small);
      font-weight: 600;
      margin-top: 6px;
      font-variant-numeric: tabular-nums;
    }
    .hint {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin-top: 2px;
    }
  `,
})
export class KpiTile {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly hint = input<string>();
  readonly icon = input<string>();
  readonly alert = input(false);
}

@Component({
  selector: 'app-empty',
  imports: [MatIconModule],
  template: `
    <div class="state">
      <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
      <h2>{{ title() }}</h2>
      @if (text()) {
        <p>{{ text() }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly text = input<string>();
}

@Component({
  selector: 'app-loading',
  template: `
    <div class="skeleton" role="status" aria-label="Loading">
      @for (r of rows; track $index) {
        <div class="bar" [style.width.%]="r"></div>
      }
    </div>
  `,
  styles: `
    .skeleton {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 8px 0;
    }
    .bar {
      height: 16px;
      border-radius: 8px;
      background: linear-gradient(
        90deg,
        var(--mat-sys-surface-container-high) 25%,
        var(--mat-sys-surface-container-highest) 50%,
        var(--mat-sys-surface-container-high) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer {
      to {
        background-position: -200% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bar {
        animation: none;
      }
    }
  `,
})
export class Loading {
  protected readonly rows = [90, 70, 80, 55];
}

/** Snackbar helpers so every page reports success and failure the same way. */
@Injectable({ providedIn: 'root' })
export class Toast {
  private readonly snack = inject(MatSnackBar);

  ok(message: string): void {
    this.snack.open(message, 'OK', { duration: 3500 });
  }

  error(e: unknown): void {
    this.snack.open(errorMessage(e), 'Dismiss', { duration: 6000, politeness: 'assertive' });
  }
}

/** Unique key per user action, so a double-click or retry is recorded once. */
export function idempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

@Component({
  selector: 'app-no-access',
  imports: [EmptyState],
  template: `<div class="page">
    <app-empty
      icon="lock"
      title="No access"
      text="Your account doesn't have permission for this page. Ask a super admin to grant it."
    />
  </div>`,
})
export class NoAccess {}
