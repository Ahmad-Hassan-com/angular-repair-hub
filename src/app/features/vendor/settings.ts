import { Component, effect, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Api } from '../../core/api';
import { Backend } from '../../core/backend';
import { Session } from '../../core/session';
import { Toast } from '../../shared/ui';
import { Profile } from '../customer/profile';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

@Component({
  selector: 'app-vendor-settings',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatChipsModule,
    Profile,
  ],
  template: `
    <div class="page narrow">
      <header class="page-header">
        <div>
          <h1>Business settings</h1>
          <p>What you repair, where, and when. Changes apply to new jobs immediately.</p>
        </div>
      </header>
      @if (session.vendor(); as v) {
        <div class="stack">
          <section class="panel">
            <h2><mat-icon>toggle_on</mat-icon>Availability</h2>
            <mat-slide-toggle
              [checked]="v.available"
              (change)="setAvailable($event.checked)"
              [disabled]="busy()"
            >
              {{ v.available ? 'Accepting new jobs' : 'Not accepting new jobs' }}
            </mat-slide-toggle>
            <p class="muted small">
              Turn this off when you're fully booked or closed. Your current jobs are not affected.
            </p>
          </section>

          <section class="panel">
            <h2><mat-icon>storefront</mat-icon>Shop and services</h2>
            <form [formGroup]="form" (ngSubmit)="save()" class="form-grid">
              <mat-form-field>
                <mat-label>Shop name</mat-label>
                <input matInput formControlName="shopName" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Service areas</mat-label>
                <mat-select formControlName="serviceAreas" multiple>
                  @for (a of catalog.value()?.areas ?? []; track a.id) {
                    <mat-option [value]="a.id">{{ a.name }}, {{ a.city }}</mat-option>
                  }
                </mat-select>
                <mat-error>Keep at least one area.</mat-error>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Repair specialties</mat-label>
                <mat-select formControlName="specialties" multiple>
                  @for (c of catalog.value()?.categories ?? []; track c.id) {
                    <mat-option [value]="c.id">{{ c.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Phone brands</mat-label>
                <mat-select formControlName="brands" multiple>
                  @for (b of catalog.value()?.brands ?? []; track b.id) {
                    <mat-option [value]="b.id">{{ b.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field class="full">
                <mat-label>About your shop (shown to customers)</mat-label>
                <textarea matInput rows="2" formControlName="bio" maxlength="400"></textarea>
              </mat-form-field>
              <div class="full">
                <span class="muted small" id="days-label">Working days</span>
                <mat-chip-listbox
                  multiple
                  formControlName="days"
                  aria-labelledby="days-label"
                  class="days"
                >
                  @for (d of days; track $index) {
                    <mat-chip-option [value]="$index">{{ d }}</mat-chip-option>
                  }
                </mat-chip-listbox>
              </div>
              <mat-form-field>
                <mat-label>Opens</mat-label>
                <input matInput type="time" formControlName="open" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Closes</mat-label>
                <input matInput type="time" formControlName="close" />
              </mat-form-field>
              <div class="full">
                <button mat-flat-button type="submit" [disabled]="busy() || form.invalid">
                  Save changes
                </button>
              </div>
            </form>
          </section>

          <section class="panel">
            <h2><mat-icon>account_balance</mat-icon>Payouts</h2>
            @if (v.payout) {
              <p>
                {{ v.payout.bankName }} · {{ v.payout.accountTitle }} ·
                <span class="mono">IBAN ••••{{ v.payout.iban.slice(-4) }}</span>
              </p>
            } @else {
              <p class="muted">No bank account on file. Contact support to add one.</p>
            }
            <p class="muted small">
              For security, payout details can only be changed through support.
            </p>
          </section>
        </div>
      }
    </div>
    <app-profile />
  `,
  styles: `
    .narrow {
      max-width: 860px;
      padding-bottom: 0;
    }
    .days {
      display: block;
      margin: 4px 0 12px;
    }
    :host ::ng-deep app-profile .page-header {
      display: none;
    }
  `,
})
export class VendorSettings {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly session = inject(Session);
  protected readonly days = DAYS;
  protected readonly busy = signal(false);
  protected readonly catalog = resource({ loader: () => this.api.query((b) => b.catalog()) });

  protected readonly form = inject(FormBuilder).nonNullable.group({
    shopName: ['', [Validators.required, Validators.minLength(2)]],
    serviceAreas: [[] as string[], Validators.required],
    specialties: [[] as string[], Validators.required],
    brands: [[] as string[], Validators.required],
    bio: [''],
    days: [[] as number[], Validators.required],
    open: ['10:00'],
    close: ['20:00'],
  });

  constructor() {
    effect(() => {
      const v = this.session.vendor();
      if (v && !this.form.dirty) {
        this.form.setValue({
          shopName: v.shopName,
          serviceAreas: v.serviceAreas,
          specialties: v.specialties,
          brands: v.brands,
          bio: v.bio ?? '',
          days: v.hours.days,
          open: v.hours.open,
          close: v.hours.close,
        });
      }
    });
  }

  private async update(
    input: Parameters<Backend['updateVendorProfile']>[1],
    ok: string,
  ): Promise<boolean> {
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.updateVendorProfile(t, input));
      this.toast.ok(ok);
      return true;
    } catch (e) {
      this.toast.error(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected setAvailable(available: boolean): void {
    this.update(
      { available },
      available ? 'You are accepting new jobs.' : 'You are no longer accepting new jobs.',
    );
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const ok = await this.update(
      {
        shopName: v.shopName,
        serviceAreas: v.serviceAreas,
        specialties: v.specialties,
        brands: v.brands,
        bio: v.bio,
        hours: { days: [...v.days].sort(), open: v.open, close: v.close },
      },
      'Business settings saved.',
    );
    if (ok) this.form.markAsPristine();
  }
}
