import { Component, input } from '@angular/core';
import { JobFinancials } from '../../core/finance';
import { PkrPipe } from '../../shared/ui';

/** Itemised money breakdown for a job. Commission lines are only shown to staff and vendors. */
@Component({
  selector: 'app-financials',
  imports: [PkrPipe],
  template: `
    @let f = data();
    <table class="fin">
      <tbody>
        @if (f.diagnostic) {
          <tr>
            <th scope="row">Diagnostic fee</th>
            <td class="num">{{ f.diagnostic | pkr }}</td>
          </tr>
        }
        <tr>
          <th scope="row">Repair parts</th>
          <td class="num">{{ f.parts | pkr }}</td>
        </tr>
        <tr>
          <th scope="row">Labour</th>
          <td class="num">{{ f.labor | pkr }}</td>
        </tr>
        <tr>
          <th scope="row">Pickup and delivery</th>
          <td class="num">{{ f.delivery | pkr }}</td>
        </tr>
        @if (f.other) {
          <tr>
            <th scope="row">Other charges</th>
            <td class="num">{{ f.other | pkr }}</td>
          </tr>
        }
        @if (f.discount) {
          <tr>
            <th scope="row">Discount</th>
            <td class="num">−{{ f.discount | pkr }}</td>
          </tr>
        }
        @if (f.tax) {
          <tr>
            <th scope="row">Tax</th>
            <td class="num">{{ f.tax | pkr }}</td>
          </tr>
        }
        <tr class="total">
          <th scope="row">Total</th>
          <td class="num">{{ f.total | pkr }}</td>
        </tr>
        <tr>
          <th scope="row">Paid</th>
          <td class="num">{{ f.paid | pkr }}</td>
        </tr>
        @if (f.refunded) {
          <tr>
            <th scope="row">Refunded</th>
            <td class="num">−{{ f.refunded | pkr }}</td>
          </tr>
        }
        <tr class="due" [class.zero]="!f.outstanding">
          <th scope="row">Outstanding</th>
          <td class="num">{{ f.outstanding | pkr }}</td>
        </tr>
      </tbody>
      @if (showSplit()) {
        <tbody class="share">
          <tr>
            <th scope="row">Platform commission</th>
            <td class="num">{{ f.commission | pkr }}</td>
          </tr>
          <tr>
            <th scope="row">Vendor earnings</th>
            <td class="num">{{ f.vendorEarnings | pkr }}</td>
          </tr>
          @if (!f.recognised && f.total) {
            <tr>
              <td colspan="2" class="muted small">Recognised once the job is paid and final.</td>
            </tr>
          }
        </tbody>
      }
    </table>
  `,
  styles: `
    .fin {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-medium);
    }
    th {
      text-align: left;
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
      padding: 4px 0;
    }
    td {
      padding: 4px 0;
    }
    .total th,
    .total td {
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding-top: 8px;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
    }
    .due th,
    .due td {
      font-weight: 600;
      color: var(--tone-warning-fg);
    }
    .due.zero th,
    .due.zero td {
      color: var(--tone-success-fg);
    }
    .share tr:first-child th,
    .share tr:first-child td {
      border-top: 1px dashed var(--mat-sys-outline-variant);
      padding-top: 8px;
    }
  `,
})
export class Financials {
  readonly data = input.required<JobFinancials>();
  readonly showSplit = input(false);
}
