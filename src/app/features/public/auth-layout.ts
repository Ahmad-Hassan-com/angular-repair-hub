import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DemoBanner } from '../../layout/demo-banner';

/** Centered card used by sign-in and registration pages. */
@Component({
  selector: 'app-auth-layout',
  imports: [RouterLink, MatIconModule, DemoBanner],
  template: `
    <app-demo-banner />
    <div class="wrap">
      <a class="brand plain" routerLink="/">
        <span class="logo"><mat-icon>build_circle</mat-icon></span>
        Repair Hub
      </a>
      <div class="card" [style.max-width.px]="width()">
        <h1>{{ heading() }}</h1>
        @if (subheading()) {
          <p class="sub">{{ subheading() }}</p>
        }
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .wrap {
      min-height: calc(100vh - 40px);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 32px 16px;
      box-sizing: border-box;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font: var(--mat-sys-title-large);
      font-weight: 700;
      color: var(--mat-sys-on-surface);
      text-decoration: none;
      margin-bottom: 24px;
    }
    .logo {
      display: inline-flex;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      align-items: center;
      justify-content: center;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .card {
      width: 100%;
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 20px;
      padding: 28px;
      box-sizing: border-box;
    }
    h1 {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 0;
    }
    .sub {
      color: var(--mat-sys-on-surface-variant);
      margin: 6px 0 20px;
    }
    @media (max-width: 599px) {
      .card {
        padding: 20px 16px;
      }
    }
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
  readonly width = input(440);
}
