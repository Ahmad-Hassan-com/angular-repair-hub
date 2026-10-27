import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../core/demo-accounts';
import { homeFor } from '../../core/session';
import { AuthLayout } from './auth-layout';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    AuthLayout,
  ],
  template: `
    <app-auth-layout
      heading="Sign in"
      subheading="Welcome back. Sign in to track your repairs."
      [width]="480"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-form-field class="full-width">
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="username" />
          @if (form.controls.email.hasError('email')) {
            <mat-error>Enter a valid email address.</mat-error>
          } @else {
            <mat-error>Email is required.</mat-error>
          }
        </mat-form-field>
        <mat-form-field class="full-width">
          <mat-label>Password</mat-label>
          <input
            matInput
            [type]="show() ? 'text' : 'password'"
            formControlName="password"
            autocomplete="current-password"
          />
          <button
            mat-icon-button
            matSuffix
            type="button"
            (click)="show.set(!show())"
            [attr.aria-label]="show() ? 'Hide password' : 'Show password'"
          >
            <mat-icon>{{ show() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
          <mat-error>Password is required.</mat-error>
        </mat-form-field>
        @if (error()) {
          <p class="callout danger" role="alert"><mat-icon>error</mat-icon>{{ error() }}</p>
        }
        <button mat-flat-button class="full-width submit" type="submit" [disabled]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <p class="links">
        New here? <a routerLink="/register">Create a customer account</a> or
        <a routerLink="/register/vendor">register your shop</a>.
      </p>

      <mat-divider />
      <section class="demo" aria-labelledby="demo-h">
        <h2 id="demo-h">Demo accounts</h2>
        <p class="muted small">
          Password for all: <code>{{ password }}</code
          >. Pick a role to sign in.
        </p>
        <div class="accounts">
          @for (a of accounts; track a.email) {
            <button type="button" class="account" (click)="useDemo(a.email)" [disabled]="busy()">
              <strong>{{ a.role }}</strong>
              <span class="muted small">{{ a.label }}</span>
            </button>
          }
        </div>
      </section>
    </app-auth-layout>
  `,
  styles: `
    .submit {
      height: 44px;
      margin-top: 4px;
    }
    .callout {
      margin: 0 0 12px;
    }
    .links {
      font: var(--mat-sys-body-medium);
      margin: 16px 0 20px;
    }
    .demo h2 {
      font: var(--mat-sys-title-small);
      margin: 20px 0 4px;
    }
    .accounts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    .account {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      text-align: left;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      font: inherit;
      cursor: pointer;
    }
    .account:hover {
      border-color: var(--mat-sys-primary);
    }
    @media (max-width: 420px) {
      .accounts {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class Login {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly returnUrl = input<string>();

  protected readonly accounts = DEMO_ACCOUNTS;
  protected readonly password = DEMO_PASSWORD;
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected useDemo(email: string): void {
    this.form.setValue({ email, password: DEMO_PASSWORD });
    this.submit();
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const { email, password } = this.form.getRawValue();
    try {
      const res = await this.api.anonymous((b) => b.login(email, password), true);
      this.api.setToken(res.token);
      const target = this.returnUrl();
      // Only follow relative in-app return URLs.
      const safe =
        target && target.startsWith('/') && !target.startsWith('//')
          ? target
          : homeFor(res.user.role);
      await this.router.navigateByUrl(safe);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
