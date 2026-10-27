import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatStepperModule } from '@angular/material/stepper';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import { Address, TIME_WINDOWS, TimeWindow } from '../../core/models';
import { pkDay } from '../../core/reports';
import { Session } from '../../core/session';
import { PhotoUpload } from '../../shared/files';
import { PkrPipe, Toast } from '../../shared/ui';

@Component({
  selector: 'app-new-request',
  imports: [
    ReactiveFormsModule,
    MatStepperModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    PhotoUpload,
    PkrPipe,
  ],
  templateUrl: './new-request.html',
  styleUrl: './new-request.scss',
})
export class NewRequest {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);
  private readonly session = inject(Session);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly catalog = resource({ loader: () => this.api.query((b) => b.catalog()) });
  protected readonly settings = resource({ loader: () => this.api.query((b, t) => b.settings(t)) });
  protected readonly windows = TIME_WINDOWS;
  protected readonly today = pkDay(new Date());
  protected readonly photos = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly sameAddress = signal(true);

  protected readonly device = this.fb.group({
    brandId: ['', Validators.required],
    modelId: ['', Validators.required],
    categoryId: ['', Validators.required],
    description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(1000)]],
  });

  protected readonly pickup = this.fb.group({
    line1: ['', [Validators.required, Validators.minLength(5)]],
    area: ['', Validators.required],
    landmark: [''],
    deliveryLine1: [''],
    deliveryArea: [''],
    date: [pkDay(new Date(Date.now() + 86_400_000)), Validators.required],
    window: ['12:00-15:00' as TimeWindow],
  });

  protected readonly consent = this.fb.group({ diagnostic: [true] });

  private readonly brandId = toSignal(this.device.controls.brandId.valueChanges, {
    initialValue: '',
  });
  private readonly deviceValue = toSignal(this.device.valueChanges, {
    initialValue: this.device.getRawValue(),
  });
  private readonly pickupValue = toSignal(this.pickup.valueChanges, {
    initialValue: this.pickup.getRawValue(),
  });

  protected readonly models = computed(() =>
    (this.catalog.value()?.models ?? []).filter((m) => m.brandId === this.brandId()),
  );
  protected readonly category = computed(() =>
    this.catalog.value()?.categories.find((c) => c.id === this.deviceValue().categoryId),
  );
  protected readonly summary = computed(() => {
    const c = this.catalog.value();
    const d = this.deviceValue();
    const p = this.pickupValue();
    return {
      device: `${c?.brands.find((b) => b.id === d.brandId)?.name ?? ''} ${c?.models.find((m) => m.id === d.modelId)?.name ?? ''}`,
      area: c?.areas.find((a) => a.id === p.area),
    };
  });

  constructor() {
    // Reset the model when the brand changes.
    effect(() => {
      this.brandId();
      this.device.controls.modelId.setValue('');
    });
    // Pre-fill the most recent saved address once.
    let filled = false;
    effect(() => {
      const saved = this.session.addresses()[0];
      if (saved && !filled) {
        filled = true;
        this.useAddress(saved);
      }
    });
  }

  protected useAddress(a: Address): void {
    this.pickup.patchValue({ line1: a.line1, area: a.area, landmark: a.landmark ?? '' });
  }

  protected savedAddresses(): Address[] {
    return this.session.addresses();
  }

  protected areaName(id: string): string {
    return this.catalog.value()?.areas.find((a) => a.id === id)?.name ?? '';
  }

  protected async submit(): Promise<void> {
    if (this.device.invalid || this.pickup.invalid) {
      this.device.markAllAsTouched();
      this.pickup.markAllAsTouched();
      return;
    }
    const d = this.device.getRawValue();
    const p = this.pickup.getRawValue();
    const areas = this.catalog.value()?.areas ?? [];
    const city = (id: string) => areas.find((a) => a.id === id)?.city ?? '';
    const pickupAddress = {
      line1: p.line1,
      area: p.area,
      city: city(p.area),
      landmark: p.landmark || undefined,
    };
    const deliveryAddress = this.sameAddress()
      ? pickupAddress
      : { line1: p.deliveryLine1, area: p.deliveryArea, city: city(p.deliveryArea) };
    this.busy.set(true);
    try {
      const job = await this.api.mutate((b, t) =>
        b.createRequest(t, {
          ...d,
          photoIds: this.photos(),
          pickupAddress,
          deliveryAddress,
          preferredPickupDate: p.date,
          preferredPickupWindow: p.window,
          diagnosticConsent: this.consent.getRawValue().diagnostic,
        }),
      );
      this.toast.ok(`Request ${job.ref} submitted. We'll notify you when a shop accepts.`);
      await this.router.navigate(['/customer/jobs', job.id]);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
