import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { JobSummary } from '../../core/backend';
import { PkDatePipe, PkrPipe, StatusBadge } from '../../shared/ui';

/** Compact job list; each row links to the role's job page. */
@Component({
  selector: 'app-job-table',
  imports: [RouterLink, MatIconModule, StatusBadge, PkrPipe, PkDatePipe],
  template: `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Job</th>
            <th>Device</th>
            <th>Status</th>
            @if (showCustomer()) {
              <th>Customer</th>
            }
            @if (showVendor()) {
              <th>Vendor</th>
            }
            <th>Area</th>
            <th class="num">Total</th>
            <th>{{ dateLabel() }}</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr class="clickable" [routerLink]="[base(), r.id]">
              <td>
                <a class="mono" [routerLink]="[base(), r.id]">{{ r.ref }}</a>
                @if (r.overdue) {
                  <span class="tone danger small" title="Past the promised date">overdue</span>
                }
                @if (r.offeredToMe) {
                  <span class="tone info small">offered to you</span>
                }
              </td>
              <td>
                {{ r.brand }} {{ r.model }}
                <div class="muted small">{{ r.category }}</div>
              </td>
              <td><app-status [status]="r.status" /></td>
              @if (showCustomer()) {
                <td>{{ r.customerName ?? '—' }}</td>
              }
              @if (showVendor()) {
                <td>{{ r.vendorName ?? '—' }}</td>
              }
              <td>{{ r.area }}</td>
              <td class="num">
                {{ r.total ? (r.total | pkr) : '—' }}
                @if (r.outstanding && r.total) {
                  <div class="small due">{{ r.outstanding | pkr }} due</div>
                }
              </td>
              <td class="small">
                {{ (dateLabel() === 'Updated' ? r.updatedAt : r.createdAt) | pkDate }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .tone.small {
      margin-left: 6px;
      padding: 1px 8px;
    }
    .due {
      color: var(--tone-warning-fg);
    }
  `,
})
export class JobTable {
  readonly rows = input.required<JobSummary[]>();
  readonly base = input.required<string>();
  readonly showCustomer = input(false);
  readonly showVendor = input(false);
  readonly dateLabel = input<'Created' | 'Updated'>('Created');
}
