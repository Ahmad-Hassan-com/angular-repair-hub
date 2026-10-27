import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HistoryView } from '../../core/backend';
import { STATUS_META } from '../../core/workflow';
import { FileThumb } from '../../shared/files';
import { PkDatePipe } from '../../shared/ui';

/** Immutable status history, newest first. */
@Component({
  selector: 'app-timeline',
  imports: [MatIconModule, PkDatePipe, FileThumb],
  template: `
    <ol class="timeline">
      @for (h of entries(); track h.id) {
        <li [class]="meta(h.to).tone">
          <span class="dot"
            ><mat-icon aria-hidden="true">{{ meta(h.to).icon }}</mat-icon></span
          >
          <div class="body">
            <div class="head">
              <strong>{{ label(h.to) }}</strong>
              <time class="muted small" [attr.datetime]="h.at">{{ h.at | pkDate: 'long' }}</time>
            </div>
            <div class="muted small">by {{ h.actorName }}</div>
            @if (h.note) {
              <p class="note">{{ h.note }}</p>
            }
            @if (h.fileIds?.length) {
              <div class="thumbs">
                @for (f of h.fileIds; track f) {
                  <app-file-thumb [id]="f" />
                }
              </div>
            }
          </div>
        </li>
      }
    </ol>
  `,
  styles: `
    .timeline {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 12px;
      position: relative;
      padding-bottom: 16px;
    }
    li:not(:last-child)::before {
      content: '';
      position: absolute;
      left: 15px;
      top: 32px;
      bottom: 0;
      width: 2px;
      background: var(--mat-sys-outline-variant);
    }
    .dot {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--tone-neutral-bg);
      color: var(--tone-neutral-fg);
    }
    .dot .mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    @each $t in info, progress, warning, success, danger {
      li.#{$t} .dot {
        background: var(--tone-#{$t}-bg);
        color: var(--tone-#{$t}-fg);
      }
    }
    .head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .note {
      margin: 6px 0 0;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      font: var(--mat-sys-body-medium);
    }
    .thumbs {
      margin-top: 8px;
    }
  `,
})
export class Timeline {
  readonly history = input.required<HistoryView[]>();
  readonly audience = input<'customer' | 'staff'>('staff');
  protected readonly entries = computed(() => [...this.history()].reverse());
  protected meta = (s: HistoryView['to']) => STATUS_META[s];
  protected label(s: HistoryView['to']): string {
    if (s === 'AWAITING_APPROVAL')
      return this.audience() === 'customer'
        ? 'Waiting for your approval'
        : 'Awaiting customer approval';
    return STATUS_META[s].label;
  }
}
