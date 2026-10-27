import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { PK_MOBILE } from '../../core/schemas';
import { AuthLayout } from './auth-layout';

export function pkPhone(c: AbstractControl): ValidationErrors | null {
  const v = String(c.value ?? '').replace(/[\s-]/g, '');
  return !v || PK_MOBILE.test(v) ? null : { phone: true };
}

export function strongPassword(c: AbstractControl): ValidationErrors | null {
  const v = String(c.value ?? '');
  return !v || (v.length >= 8 && /[a-zA-Z]/.test(v) && /\d/.test(v)) ? null : { weak: true };
}

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    AuthLayout,
  ],
  template: `
    <app-auth-layout
      heading="Create your account"
      subheading="Request repairs, approve quotes and track your phone."
    >
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-form-field class="full-width">
          <mat-label>Full name</mat-label>
          <input matInput formControlName="name" autocomplete="name" />
          <mat-error>Enter your name.</mat-error>
        </mat-form-field>
        <mat-form-field class="full-width">
          <mat-label>Mobile number</mat-label>
          <input
            matInput
            formControlName="phone"
            autocomplete="tel"
            inputmode="tel"
            placeholder="0300 1234567"
          />
          <mat-hint>Used for pickup and delivery updates.</mat-hint>
          <mat-error>Enter a Pakistani mobile number, e.g. 0300 1234567.</mat-error>
        </mat-form-field>
        <mat-form-field class="full-width">
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="email" />
          <mat-error>Enter a valid email address.</mat-error>
        </mat-form-field>
        <mat-form-field class="full-width">
          <mat-label>Password</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="new-password" />
          <mat-hint>At least 8 characters, with letters and numbers.</mat-hint>
          <mat-error>Use at least 8 characters, with letters and numbers.</mat-error>
        </mat-form-field>
        @if (error()) {
          <p class="callout danger" role="alert"><mat-icon>error</mat-icon>{{ error() }}</p>
        }
        <button mat-flat-button class="full-width submit" type="submit" [disabled]="busy()">
          {{ busy() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
      <p class="links">
        Already have an account? <a routerLink="/login">Sign in</a>.<br />
        Own a repair shop? <a routerLink="/register/vendor">Register as a vendor</a>.
      </p>
    </app-auth-layout>
  `,
  styles: `
    mat-form-field {
      margin-bottom: 4px;
    }
    .submit {
      height: 44px;
      margin-top: 8px;
    }
    .callout {
      margin: 8px 0;
    }
    .links {
      margin: 16px 0 0;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class Register {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, pkPhone]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, strongPassword]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const value = this.form.getRawValue();
      const res = await this.api.anonymous((b) => b.registerCustomer(value), true);
      this.api.setToken(res.token);
      await this.router.navigate(['/customer/profile'], { queryParams: { welcome: 1 } });
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
