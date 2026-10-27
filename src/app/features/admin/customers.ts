import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../../core/api';
import { downloadCsv, pkDay, toCsv } from '../../core/reports';
import { Dialogs } from '../../shared/dialogs';
import { EmptyState, Loading, PkDatePipe, Toast } from '../../shared/ui';

@Component({
  selector: 'app-admin-customers',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    PkDatePipe,
    Loading,
    EmptyState,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Customers</h1>
          <p>{{ (users.value() ?? []).length }} customer accounts.</p>
        </div>
        <button mat-stroked-button type="button" (click)="export()">
          <mat-icon>download</mat-icon>Export CSV
        </button>
      </header>
      <div class="toolbar-filters">
        <mat-form-field class="search" subscriptSizing="dynamic">
          <mat-label>Search</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
            placeholder="Name, email or phone"
          />
        </mat-form-field>
      </div>
      @if (!users.hasValue()) {
        <app-loading />
      } @else if (!rows().length) {
        <div class="panel"><app-empty icon="group" title="No customers found" /></div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Phone verified</th>
                <th class="num">Requests</th>
                <th>Joined</th>
                <th>Last sign-in</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (u of rows(); track u.id) {
                <tr>
                  <td>
                    {{ u.name }}
                    @if (u.demo) {
                      <span class="tone neutral">demo</span>
                    }
                  </td>
                  <td>
                    {{ u.email }}
                    <div class="muted small">{{ u.phone }}</div>
                  </td>
                  <td>{{ u.phoneVerified ? 'Yes' : 'No' }}</td>
                  <td class="num">{{ u.jobs }}</td>
                  <td class="small">{{ u.createdAt | pkDate: 'date' }}</td>
                  <td class="small">{{ u.lastLoginAt | pkDate }}</td>
                  <td>
                    <span class="tone" [class]="u.status === 'ACTIVE' ? 'success' : 'danger'">{{
                      u.status.toLowerCase()
                    }}</span>
                  </td>
                  <td>
                    <button mat-button type="button" (click)="toggle(u.id, u.status)">
                      {{ u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate' }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AdminCustomers {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly dialogs = inject(Dialogs);
  protected readonly search = signal('');
  protected readonly users = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.listUsers(t, 'CUSTOMER')),
  });
  protected readonly rows = computed(() => {
    const s = this.search().trim().toLowerCase();
    return (this.users.value() ?? []).filter(
      (u) => !s || [u.name, u.email, u.phone].some((v) => v.toLowerCase().includes(s)),
    );
  });

  protected async toggle(id: string, status: string): Promise<void> {
    const suspend = status === 'ACTIVE';
    if (
      suspend &&
      !(await this.dialogs.confirm(
        'Suspend this customer?',
        'They will be signed out and unable to sign in until reactivated.',
        'Suspend',
        true,
      ))
    )
      return;
    try {
      await this.api.mutate((b, t) => b.setUserStatus(t, id, suspend ? 'SUSPENDED' : 'ACTIVE'));
      this.toast.ok(suspend ? 'Customer suspended.' : 'Customer reactivated.');
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected export(): void {
    downloadCsv(
      `customers-${pkDay(new Date())}.csv`,
      toCsv(this.rows(), [
        { header: 'Name', value: (u) => u.name },
        { header: 'Email', value: (u) => u.email },
        { header: 'Phone', value: (u) => u.phone },
        { header: 'Requests', value: (u) => u.jobs },
        { header: 'Joined', value: (u) => pkDay(u.createdAt) },
        { header: 'Status', value: (u) => u.status },
      ]),
    );
  }
}
