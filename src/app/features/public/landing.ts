import { Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { homeFor, Session } from '../../core/session';
import { DemoBanner } from '../../layout/demo-banner';
import { PkrPipe } from '../../shared/ui';

@Component({
  selector: 'app-landing',
  imports: [RouterLink, MatButtonModule, MatIconModule, PkrPipe, DemoBanner],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  private readonly api = inject(Api);
  protected readonly session = inject(Session);
  protected readonly catalog = resource({ loader: () => this.api.anonymous((b) => b.catalog()) });
  protected readonly cities = computed(() => [
    ...new Set((this.catalog.value()?.areas ?? []).map((a) => a.city)),
  ]);
  protected readonly dashboard = computed(() => {
    const role = this.session.role();
    return role ? homeFor(role) : null;
  });

  protected readonly steps = [
    {
      icon: 'edit_note',
      title: 'Tell us what’s wrong',
      text: 'Pick your phone and the problem, add photos and choose a pickup slot.',
    },
    {
      icon: 'storefront',
      title: 'A verified shop accepts',
      text: 'Approved repair shops near you that fix your brand can take the job.',
    },
    {
      icon: 'two_wheeler',
      title: 'Doorstep pickup',
      text: 'A courier collects the phone. You hand over a one-time code, and the phone’s condition is recorded.',
    },
    {
      icon: 'request_quote',
      title: 'Approve the quote',
      text: 'The shop inspects it and sends an itemised quote. No repair starts until you approve.',
    },
    {
      icon: 'build',
      title: 'Track the repair',
      text: 'Follow every step on a timeline, with before-and-after photos.',
    },
    {
      icon: 'verified',
      title: 'Delivered with warranty',
      text: 'Pay on delivery or by bank transfer. Download your receipt and warranty.',
    },
  ];

  protected readonly trust = [
    {
      icon: 'lock',
      title: 'Your details stay private',
      text: 'Shops see your address and number only after they accept your job.',
    },
    {
      icon: 'pin',
      title: 'Code-verified handovers',
      text: 'Pickups and deliveries are confirmed with a one-time code that only you have.',
    },
    {
      icon: 'receipt_long',
      title: 'Clear pricing',
      text: 'Parts, labour and delivery are itemised. Extra charges always need your approval.',
    },
  ];
}
