import { Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { Api } from '../../core/api';
import { Loading, Toast } from '../../shared/ui';

/** Admin picks a vendor for a job; best matches are listed first. */
@Component({
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatRadioModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    Loading,
  ],
  template: `
    <h2 mat-dialog-title>Assign {{ data.ref }} to a vendor</h2>
    <mat-dialog-content>
      <p class="muted small">
        The vendor is notified and has {{ data.timeoutHours }} hours to accept before the job
        returns to the queue.
      </p>
      @if (candidates.isLoading()) {
        <app-loading />
      } @else {
        <mat-radio-group [(ngModel)]="selected" class="list" aria-label="Vendor">
          @for (c of candidates.value() ?? []; track c.vendorId) {
            <mat-radio-button [value]="c.vendorId" [disabled]="c.vendorId === data.currentVendorId">
              <span class="name">{{ c.shopName }}</span>
              <span class="meta">
                @if (c.eligible) {
                  <span class="tone success">Eligible</span>
                } @else {
                  <span class="tone warning">
                    {{
                      !c.coversArea
                        ? 'Outside area'
                        : !c.specialist
                          ? 'Not a specialist'
                          : !c.brand
                            ? "Doesn't fix brand"
                            : 'Unavailable'
                    }}
                  </span>
                }
                <span class="muted small"
                  >{{ c.activeJobs }} active · {{ c.rating ? c.rating + '★' : 'no ratings' }}</span
                >
              </span>
            </mat-radio-button>
          } @empty {
            <p>No approved vendors yet.</p>
          }
        </mat-radio-group>
        <mat-form-field class="full-width" subscriptSizing="dynamic">
          <mat-label>Note to the vendor (optional)</mat-label>
          <input matInput [(ngModel)]="note" maxlength="200" />
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [disabled]="!selected || busy()" (click)="assign()">
        Assign
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }
    .name {
      font-weight: 600;
      margin-right: 8px;
    }
    .meta {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
  `,
})
export class AssignDialog {
  protected readonly data = inject<{
    jobId: string;
    ref: string;
    currentVendorId?: string;
    timeoutHours: number;
  }>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<AssignDialog, boolean>);
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly candidates = resource({
    loader: () => this.api.query((b, t) => b.candidateVendors(t, this.data.jobId)),
  });
  protected selected = '';
  protected note = '';
  protected readonly busy = signal(false);

  protected async assign(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.assignVendor(t, this.data.jobId, this.selected, this.note));
      this.toast.ok('Vendor notified.');
      this.ref.close(true);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
