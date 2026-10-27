import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { Api } from '../../core/api';
import { VendorStatus } from '../../core/models';
import { Dialogs } from '../../shared/dialogs';
import { FileThumb } from '../../shared/files';
import { EmptyState, Loading, PkDatePipe, Toast } from '../../shared/ui';

@Component({
  selector: 'app-admin-vendors',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatExpansionModule,
    MatIconModule,
    PkDatePipe,
    Loading,
    EmptyState,
    FileThumb,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Vendors</h1>
          <p>
            Approve new shops, and suspend or reactivate existing ones. Vendors see the reason you
            give.
          </p>
        </div>
      </header>
      <div class="toolbar-filters">
        <mat-button-toggle-group
          [ngModel]="filter()"
          (ngModelChange)="filter.set($event)"
          aria-label="Vendor status"
        >
          <mat-button-toggle value="PENDING">Pending ({{ count('PENDING') }})</mat-button-toggle>
          <mat-button-toggle value="APPROVED">Approved ({{ count('APPROVED') }})</mat-button-toggle>
          <mat-button-toggle value="SUSPENDED"
            >Suspended ({{ count('SUSPENDED') }})</mat-button-toggle
          >
          <mat-button-toggle value="REJECTED">Rejected ({{ count('REJECTED') }})</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      @if (!vendors.hasValue()) {
        <app-loading />
      } @else if (!rows().length) {
        <div class="panel"><app-empty icon="storefront" title="No vendors here" /></div>
      } @else {
        <mat-accordion multi>
          @for (v of rows(); track v.userId) {
            <mat-expansion-panel [expanded]="v.status === 'PENDING'">
              <mat-expansion-panel-header>
                <mat-panel-title>{{ v.shopName }}</mat-panel-title>
                <mat-panel-description>
                  {{ v.public.areaName }} ·
                  {{ v.public.rating ? v.public.rating + '★' : 'no ratings' }} ·
                  {{ v.activeJobs }} active
                </mat-panel-description>
              </mat-expansion-panel-header>
              <div class="grid-2">
                <dl class="facts">
                  <dt>Owner</dt>
                  <dd>{{ v.ownerName }}</dd>
                  <dt>Contact</dt>
                  <dd>{{ v.phone }} · {{ v.email }}</dd>
                  <dt>Address</dt>
                  <dd>{{ v.address.line1 }}, {{ v.address.city }}</dd>
                  <dt>Registered</dt>
                  <dd>{{ v.createdAt | pkDate: 'date' }}</dd>
                  <dt>Service areas</dt>
                  <dd>{{ names('areas', v.serviceAreas) }}</dd>
                  <dt>Specialties</dt>
                  <dd>{{ names('categories', v.specialties) }}</dd>
                  <dt>Brands</dt>
                  <dd>{{ names('brands', v.brands) }}</dd>
                  <dt>Payout</dt>
                  <dd>
                    {{ v.payout ? v.payout.bankName + ' · ' + v.payout.iban : 'Not provided' }}
                  </dd>
                  @if (v.statusReason) {
                    <dt>Reason</dt>
                    <dd>{{ v.statusReason }}</dd>
                  }
                </dl>
                <div>
                  <h3>Documents</h3>
                  @if (v.documents.length) {
                    <div class="thumbs">
                      @for (d of v.documents; track d.fileId) {
                        <app-file-thumb [id]="d.fileId" />
                      }
                    </div>
                  } @else {
                    <p class="muted">No documents uploaded.</p>
                  }
                  <h3>Performance</h3>
                  <p>
                    {{ v.public.completedJobs }} completed repairs ·
                    {{ v.public.reviewCount }} reviews
                  </p>
                </div>
              </div>
              <div class="row actions">
                @switch (v.status) {
                  @case ('PENDING') {
                    <button
                      mat-flat-button
                      type="button"
                      (click)="set(v.userId, 'APPROVED')"
                      [disabled]="busy()"
                    >
                      <mat-icon>check</mat-icon>Approve
                    </button>
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="set(v.userId, 'REJECTED')"
                      [disabled]="busy()"
                    >
                      Reject
                    </button>
                  }
                  @case ('APPROVED') {
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="set(v.userId, 'SUSPENDED')"
                      [disabled]="busy()"
                    >
                      <mat-icon>block</mat-icon>Suspend
                    </button>
                  }
                  @default {
                    <button
                      mat-flat-button
                      type="button"
                      (click)="set(v.userId, 'APPROVED')"
                      [disabled]="busy()"
                    >
                      <mat-icon>restart_alt</mat-icon
                      >{{ v.status === 'REJECTED' ? 'Approve' : 'Reactivate' }}
                    </button>
                  }
                }
              </div>
            </mat-expansion-panel>
          }
        </mat-accordion>
      }
    </div>
  `,
  styles: `
    h3 {
      font: var(--mat-sys-title-small);
      margin: 0 0 8px;
    }
    .actions {
      margin-top: 16px;
    }
  `,
})
export class AdminVendors {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly dialogs = inject(Dialogs);
  protected readonly filter = signal<VendorStatus>('PENDING');
  protected readonly busy = signal(false);
  protected readonly vendors = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.listVendors(t)),
  });
  protected readonly catalog = resource({ loader: () => this.api.query((b) => b.catalog()) });
  protected readonly rows = computed(() =>
    (this.vendors.value() ?? []).filter((v) => v.status === this.filter()),
  );

  protected count(s: VendorStatus): number {
    return (this.vendors.value() ?? []).filter((v) => v.status === s).length;
  }

  protected names(table: 'areas' | 'categories' | 'brands', ids: string[]): string {
    const rows = (this.catalog.value()?.[table] ?? []) as { id: string; name: string }[];
    return ids.map((id) => rows.find((r) => r.id === id)?.name ?? id).join(', ');
  }

  protected async set(id: string, status: VendorStatus): Promise<void> {
    let reason = '';
    if (status === 'REJECTED' || status === 'SUSPENDED') {
      const r = await this.dialogs.prompt(
        status === 'REJECTED' ? 'Reject application' : 'Suspend vendor',
        'The vendor will see this reason.',
        'Reason',
        status === 'REJECTED' ? 'Reject' : 'Suspend',
        true,
        true,
      );
      if (r === null) return;
      reason = r;
    }
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.setVendorStatus(t, id, status, reason));
      this.toast.ok(`Vendor ${status.toLowerCase()}.`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
