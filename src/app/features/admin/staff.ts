import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api } from '../../core/api';
import { Permission, PERMISSIONS, PublicUser } from '../../core/models';
import { Session } from '../../core/session';
import { Loading, PkDatePipe, Toast } from '../../shared/ui';
import { pkPhone, strongPassword } from '../public/register';

export const PERMISSION_LABEL: Record<Permission, string> = {
  'jobs.view': 'View all jobs',
  'jobs.assign': 'Assign and manage jobs',
  'jobs.cancel': 'Cancel jobs',
  'deliveries.manage': 'Coordinate pickups and deliveries',
  'vendors.manage': 'Approve and suspend vendors',
  'customers.manage': 'Manage customers',
  'payments.verify': 'Record and verify payments',
  'refunds.issue': 'Issue refunds',
  'settlements.manage': 'Vendor settlements',
  'complaints.manage': 'Handle complaints and disputes',
  'reviews.moderate': 'Moderate reviews',
  'reports.view': 'View reports and dashboards',
  'catalog.manage': 'Manage catalogue',
  'settings.manage': 'System settings and notifications',
  'staff.manage': 'Manage staff accounts',
  'audit.view': 'View audit log',
};

@Component({
  selector: 'app-admin-staff',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    PkDatePipe,
    Loading,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Staff and permissions</h1>
          <p>
            Staff get only the permissions you tick; they never get super-admin rights. Delivery
            agents see only tasks assigned to them.
          </p>
        </div>
      </header>
      @if (!users.hasValue()) {
        <app-loading />
      } @else {
        <mat-accordion multi>
          @for (u of users.value(); track u.id) {
            <mat-expansion-panel [disabled]="u.role !== 'STAFF'">
              <mat-expansion-panel-header>
                <mat-panel-title>{{ u.name }}</mat-panel-title>
                <mat-panel-description>
                  <span
                    class="tone"
                    [class]="
                      u.role === 'SUPER_ADMIN'
                        ? 'info'
                        : u.role === 'AGENT'
                          ? 'progress'
                          : 'neutral'
                    "
                    >{{ roleLabel(u) }}</span
                  >
                  <span class="hide-sm">{{ u.email }}</span>
                  @if (u.status !== 'ACTIVE') {
                    <span class="tone danger">suspended</span>
                  }
                </mat-panel-description>
              </mat-expansion-panel-header>
              @if (u.role === 'STAFF') {
                <div class="perms">
                  @for (p of perms; track p) {
                    <mat-checkbox
                      [checked]="draft[u.id]?.includes(p) ?? u.permissions.includes(p)"
                      (change)="toggle(u, p, $event.checked)"
                      >{{ label[p] }}</mat-checkbox
                    >
                  }
                </div>
                <div class="row">
                  <button
                    mat-flat-button
                    type="button"
                    (click)="savePerms(u)"
                    [disabled]="!draft[u.id] || busy()"
                  >
                    Save permissions
                  </button>
                  <button mat-button type="button" (click)="setStatus(u)">
                    {{ u.status === 'ACTIVE' ? 'Suspend account' : 'Reactivate' }}
                  </button>
                  <span class="muted small">Last sign-in {{ u.lastLoginAt | pkDate }}</span>
                </div>
              }
            </mat-expansion-panel>
          }
        </mat-accordion>
      }

      <section class="panel mt">
        <h2><mat-icon>person_add</mat-icon>Add a staff member or delivery agent</h2>
        <form [formGroup]="form" (ngSubmit)="create()" class="form-grid">
          <mat-form-field>
            <mat-label>Role</mat-label>
            <mat-select formControlName="role">
              <mat-option value="STAFF">Operations staff</mat-option>
              <mat-option value="AGENT">Delivery agent</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Full name</mat-label>
            <input matInput formControlName="name" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" />
            <mat-error>Enter a valid email.</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Mobile</mat-label>
            <input matInput formControlName="phone" />
            <mat-error>Enter a Pakistani mobile number.</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Temporary password</mat-label>
            <input matInput type="text" formControlName="password" autocomplete="new-password" />
            <mat-error>At least 8 characters, with letters and numbers.</mat-error>
          </mat-form-field>
          @if (form.value.role === 'STAFF') {
            <div class="full perms">
              @for (p of perms; track p) {
                <mat-checkbox
                  [checked]="newPerms().includes(p)"
                  (change)="
                    newPerms.set(
                      $event.checked ? [...newPerms(), p] : newPerms().filter((x) => x !== p)
                    )
                  "
                  >{{ label[p] }}</mat-checkbox
                >
              }
            </div>
          }
          <div class="full">
            <button mat-flat-button type="submit" [disabled]="busy()">Create account</button>
          </div>
        </form>
      </section>
    </div>
  `,
  styles: `
    mat-panel-description {
      gap: 12px;
      align-items: center;
    }
    .perms {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 0 16px;
      margin-bottom: 12px;
    }
    .mt {
      margin-top: 16px;
    }
    @media (max-width: 599px) {
      .hide-sm {
        display: none;
      }
    }
  `,
})
export class AdminStaff {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly session = inject(Session);
  protected readonly perms = PERMISSIONS;
  protected readonly label = PERMISSION_LABEL;
  protected readonly busy = signal(false);
  protected readonly newPerms = signal<Permission[]>(['jobs.view']);
  protected draft: Record<string, Permission[]> = {};

  protected readonly users = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.listUsers(t, 'STAFF_AND_AGENTS')),
  });

  protected readonly form = inject(FormBuilder).nonNullable.group({
    role: ['STAFF' as 'STAFF' | 'AGENT'],
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, pkPhone]],
    password: ['', [Validators.required, strongPassword]],
  });

  protected roleLabel(u: PublicUser): string {
    return u.role === 'SUPER_ADMIN'
      ? 'Super admin'
      : u.role === 'AGENT'
        ? 'Delivery agent'
        : `Staff · ${u.permissions.length} permissions`;
  }

  protected toggle(u: PublicUser, p: Permission, on: boolean): void {
    const current = this.draft[u.id] ?? [...u.permissions];
    this.draft[u.id] = on ? [...new Set([...current, p])] : current.filter((x) => x !== p);
  }

  private async run(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await fn();
      this.toast.ok(ok);
      return true;
    } catch (e) {
      this.toast.error(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async savePerms(u: PublicUser): Promise<void> {
    const perms = this.draft[u.id];
    if (
      await this.run(
        () => this.api.mutate((b, t) => b.setPermissions(t, u.id, perms)),
        'Permissions updated.',
      )
    )
      delete this.draft[u.id];
  }

  protected setStatus(u: PublicUser): void {
    this.run(
      () =>
        this.api.mutate((b, t) =>
          b.setUserStatus(t, u.id, u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'),
        ),
      'Account updated.',
    );
  }

  protected async create(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input = { ...v, permissions: v.role === 'STAFF' ? this.newPerms() : [] };
    if (
      await this.run(
        () => this.api.mutate((b, t) => b.createStaff(t, input)),
        'Account created. Share the temporary password securely.',
      )
    )
      this.form.reset({ role: 'STAFF' });
  }
}
