import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatStepperModule } from '@angular/material/stepper';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { PhotoUpload } from '../../shared/files';
import { AuthLayout } from './auth-layout';
import { pkPhone, strongPassword } from './register';

@Component({
  selector: 'app-register-vendor',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatStepperModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatChipsModule,
    MatSlideToggleModule,
    AuthLayout,
    PhotoUpload,
  ],
  templateUrl: './register-vendor.html',
  styles: `
    .actions {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 12px;
    }
    .callout {
      margin: 12px 0;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 8px 0;
    }
    .terms {
      margin: 12px 0;
    }
    .links {
      margin: 16px 0 0;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class RegisterVendor {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly catalog = resource({ loader: () => this.api.anonymous((b) => b.catalog()) });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly documents = signal<string[]>([]);
  protected readonly withPayout = signal(true);

  protected readonly account = this.fb.group({
    ownerName: ['', [Validators.required, Validators.minLength(2)]],
    shopName: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, pkPhone]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, strongPassword]],
  });

  protected readonly business = this.fb.group({
    line1: ['', [Validators.required, Validators.minLength(5)]],
    area: ['', Validators.required],
    serviceAreas: [[] as string[], Validators.required],
    specialties: [[] as string[], Validators.required],
    brands: [[] as string[], Validators.required],
  });

  protected readonly payout = this.fb.group({
    bankName: ['', Validators.required],
    accountTitle: ['', Validators.required],
    iban: ['', [Validators.required, Validators.pattern(/^PK\d{2}[A-Za-z]{4}\d{16}$/)]],
    acceptTerms: [false, Validators.requiredTrue],
  });

  protected cityOf(areaId: string): string {
    return this.catalog.value()?.areas.find((a) => a.id === areaId)?.city ?? '';
  }

  protected async submit(): Promise<void> {
    const payoutCtrl = this.payout.controls;
    if (!this.withPayout()) {
      for (const k of ['bankName', 'accountTitle', 'iban'] as const) payoutCtrl[k].disable();
    } else {
      for (const k of ['bankName', 'accountTitle', 'iban'] as const) payoutCtrl[k].enable();
    }
    if (this.account.invalid || this.business.invalid || this.payout.invalid) {
      this.payout.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const a = this.account.getRawValue();
    const b = this.business.getRawValue();
    const p = this.payout.getRawValue();
    try {
      const res = await this.api.anonymous(
        (backend) =>
          backend.registerVendor({
            ...a,
            address: { line1: b.line1, area: b.area, city: this.cityOf(b.area) },
            serviceAreas: b.serviceAreas,
            specialties: b.specialties,
            brands: b.brands,
            documentFileIds: this.documents(),
            payout: this.withPayout()
              ? {
                  bankName: p.bankName,
                  accountTitle: p.accountTitle,
                  iban: p.iban.replace(/\s/g, ''),
                }
              : undefined,
            acceptTerms: p.acceptTerms,
          }),
        true,
      );
      this.api.setToken(res.token);
      await this.router.navigate(['/vendor']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
