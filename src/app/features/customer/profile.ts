import { Component, effect, inject, input, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Api } from '../../core/api';
import { Address } from '../../core/models';
import { Session } from '../../core/session';
import { Dialogs } from '../../shared/dialogs';
import { Toast } from '../../shared/ui';
import { pkPhone, strongPassword } from '../public/register';

@Component({
  selector: 'app-profile',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="page narrow">
      <header class="page-header">
        <div>
          <h1>Profile</h1>
          <p>{{ session.user()?.email }}</p>
        </div>
      </header>
      @if (welcome()) {
        <p class="callout success">
          <mat-icon>celebration</mat-icon
          ><span
            >Welcome to Repair Hub! Verify your mobile number, then request your first repair.</span
          >
        </p>
      }

      <div class="stack">
        <section class="panel">
          <h2><mat-icon>person</mat-icon>Your details</h2>
          <form [formGroup]="details" (ngSubmit)="save()" class="form-grid">
            <mat-form-field>
              <mat-label>Full name</mat-label>
              <input matInput formControlName="name" autocomplete="name" />
              <mat-error>Enter your name.</mat-error>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Mobile number</mat-label>
              <input matInput formControlName="phone" inputmode="tel" autocomplete="tel" />
              <mat-hint>Changing it requires verifying again.</mat-hint>
              <mat-error>Enter a Pakistani mobile number.</mat-error>
            </mat-form-field>
            <div class="full row">
              <button mat-flat-button type="submit" [disabled]="busy()">Save details</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <h2><mat-icon>sms</mat-icon>Mobile verification</h2>
          @if (session.user()?.phoneVerified) {
            <p class="callout success">
              <mat-icon>verified</mat-icon><span>{{ session.user()?.phone }} is verified.</span>
            </p>
          } @else {
            <p>We'll send a 6-digit code to {{ session.user()?.phone }}.</p>
            @if (demoCode()) {
              <p class="callout warning small">
                <mat-icon>info</mat-icon>
                <span
                  >No SMS provider is configured in this demo, so nothing was sent. Your code is
                  <strong class="mono">{{ demoCode() }}</strong
                  >.</span
                >
              </p>
            }
            <div class="row">
              <button mat-stroked-button type="button" (click)="sendCode()" [disabled]="busy()">
                {{ demoCode() ? 'Send a new code' : 'Send code' }}
              </button>
              <mat-form-field subscriptSizing="dynamic" class="code">
                <mat-label>Code</mat-label>
                <input
                  matInput
                  [(ngModel)]="code"
                  inputmode="numeric"
                  maxlength="6"
                  autocomplete="one-time-code"
                />
              </mat-form-field>
              <button
                mat-flat-button
                type="button"
                (click)="verify()"
                [disabled]="busy() || code.length !== 6"
              >
                Verify
              </button>
            </div>
          }
        </section>

        @if (session.role() === 'CUSTOMER') {
          <section class="panel">
            <h2><mat-icon>home</mat-icon>Saved addresses</h2>
            @for (a of addresses(); track $index) {
              <div class="addr row">
                <span
                  >{{ a.line1 }}, {{ areaName(a.area) }}, {{ a.city
                  }}{{ a.landmark ? ' (' + a.landmark + ')' : '' }}</span
                >
                <span class="spacer"></span>
                <button
                  mat-icon-button
                  type="button"
                  (click)="removeAddress($index)"
                  [attr.aria-label]="'Remove address ' + ($index + 1)"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            } @empty {
              <p class="muted">Addresses you use for pickups are saved here automatically.</p>
            }
            @if (addresses().length < 5) {
              <form [formGroup]="address" (ngSubmit)="addAddress()" class="form-grid mt">
                <mat-form-field class="full">
                  <mat-label>New address</mat-label>
                  <input matInput formControlName="line1" />
                </mat-form-field>
                <mat-form-field>
                  <mat-label>Area</mat-label>
                  <mat-select formControlName="area">
                    @for (a of catalog.value()?.areas ?? []; track a.id) {
                      <mat-option [value]="a.id">{{ a.name }}, {{ a.city }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field>
                  <mat-label>Landmark (optional)</mat-label>
                  <input matInput formControlName="landmark" />
                </mat-form-field>
                <div class="full">
                  <button mat-stroked-button type="submit" [disabled]="address.invalid || busy()">
                    Add address
                  </button>
                </div>
              </form>
            }
          </section>
        }

        <section class="panel">
          <h2><mat-icon>key</mat-icon>Password</h2>
          <form [formGroup]="password" (ngSubmit)="changePassword()" class="form-grid">
            <mat-form-field>
              <mat-label>Current password</mat-label>
              <input
                matInput
                type="password"
                formControlName="current"
                autocomplete="current-password"
              />
            </mat-form-field>
            <mat-form-field>
              <mat-label>New password</mat-label>
              <input matInput type="password" formControlName="next" autocomplete="new-password" />
              <mat-error>At least 8 characters, with letters and numbers.</mat-error>
            </mat-form-field>
            <div class="full">
              <button mat-stroked-button type="submit" [disabled]="password.invalid || busy()">
                Change password
              </button>
            </div>
          </form>
          <p class="muted small">Changing your password signs you out on other devices.</p>
        </section>

        @if (session.role() === 'CUSTOMER') {
          <section class="panel danger-zone">
            <h2><mat-icon>delete_forever</mat-icon>Delete account</h2>
            <p class="muted">
              Your name, email, phone and addresses are removed. Repair and payment records are
              kept, anonymised, for accounting. You can't delete your account while a repair is in
              progress.
            </p>
            <button mat-stroked-button type="button" class="danger" (click)="deleteAccount()">
              Delete my account
            </button>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    .narrow {
      max-width: 860px;
    }
    .callout {
      margin: 0 0 16px;
    }
    .code {
      width: 140px;
    }
    .addr {
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .mt {
      margin-top: 12px;
    }
    .danger {
      color: var(--mat-sys-error);
    }
  `,
})
export class Profile {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly dialogs = inject(Dialogs);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly session = inject(Session);
  readonly welcome = input<string>();

  protected readonly catalog = resource({ loader: () => this.api.query((b) => b.catalog()) });
  protected readonly busy = signal(false);
  protected readonly demoCode = signal('');
  protected readonly addresses = signal<Address[]>([]);
  protected code = '';

  protected readonly details = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, pkPhone]],
  });
  protected readonly address = this.fb.group({
    line1: ['', [Validators.required, Validators.minLength(5)]],
    area: ['', Validators.required],
    landmark: [''],
  });
  protected readonly password = this.fb.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, strongPassword]],
  });

  constructor() {
    effect(() => {
      const u = this.session.user();
      if (u && !this.details.dirty) this.details.setValue({ name: u.name, phone: u.phone });
      this.addresses.set(this.session.addresses());
    });
  }

  protected areaName(id: string): string {
    return this.catalog.value()?.areas.find((a) => a.id === id)?.name ?? '';
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

  protected async save(): Promise<void> {
    if (this.details.invalid) return;
    const v = this.details.getRawValue();
    if (await this.run(() => this.api.mutate((b, t) => b.updateProfile(t, v)), 'Details saved.'))
      this.details.markAsPristine();
  }

  protected async sendCode(): Promise<void> {
    await this.run(async () => {
      const res = await this.api.mutate((b, t) => b.requestPhoneCode(t));
      this.demoCode.set(res.demoCode ?? '');
    }, 'Code ready.');
  }

  protected verify(): void {
    this.run(
      () => this.api.mutate((b, t) => b.verifyPhone(t, this.code)),
      'Mobile number verified.',
    );
  }

  private saveAddresses(list: Address[], ok: string) {
    const u = this.session.user()!;
    return this.run(
      () =>
        this.api.mutate((b, t) =>
          b.updateProfile(t, { name: u.name, phone: u.phone, addresses: list }),
        ),
      ok,
    );
  }

  protected async addAddress(): Promise<void> {
    const v = this.address.getRawValue();
    const city = this.catalog.value()?.areas.find((a) => a.id === v.area)?.city ?? '';
    if (
      await this.saveAddresses(
        [
          ...this.addresses(),
          { line1: v.line1, area: v.area, city, landmark: v.landmark || undefined },
        ],
        'Address added.',
      )
    )
      this.address.reset();
  }

  protected removeAddress(i: number): void {
    this.saveAddresses(
      this.addresses().filter((_, idx) => idx !== i),
      'Address removed.',
    );
  }

  protected async changePassword(): Promise<void> {
    const v = this.password.getRawValue();
    if (
      await this.run(
        () => this.api.mutate((b, t) => b.changePassword(t, v.current, v.next)),
        'Password changed.',
      )
    )
      this.password.reset();
  }

  protected async deleteAccount(): Promise<void> {
    const ok = await this.dialogs.confirm(
      'Delete your account?',
      'This cannot be undone.',
      'Delete account',
      true,
    );
    if (!ok) return;
    if (
      await this.run(
        () => this.api.mutate((b, t) => b.deleteAccount(t)),
        'Your account has been deleted.',
      )
    ) {
      this.api.setToken(null);
      location.assign('/');
    }
  }
}
