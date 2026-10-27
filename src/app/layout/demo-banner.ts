import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Dialogs } from '../shared/dialogs';

@Component({
  selector: 'app-demo-banner',
  imports: [MatButtonModule],
  template: `
    <div class="demo-banner" role="note">
      <span
        ><strong>Portfolio demo.</strong> The backend runs in your browser and stores data
        locally<span class="long">. Records marked as demo data were generated for development</span
        >.</span
      >
      <button mat-button type="button" (click)="reset()">Reset demo data</button>
    </div>
  `,
  styles: `
    .demo-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 4px 16px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font: var(--mat-sys-body-small);
      text-align: center;
    }
    @media (max-width: 599px) {
      .long {
        display: none;
      }
    }
    button {
      --mat-button-text-label-text-color: var(--mat-sys-on-tertiary-container);
      height: 28px;
    }
  `,
})
export class DemoBanner {
  private readonly api = inject(Api);
  private readonly dialogs = inject(Dialogs);
  private readonly router = inject(Router);

  protected async reset(): Promise<void> {
    const ok = await this.dialogs.confirm(
      'Reset demo data?',
      'Everything you created in this browser is deleted and the original demo data is restored. You will be signed out.',
      'Reset',
      true,
    );
    if (!ok) return;
    this.api.resetDemo();
    await this.router.navigate(['/login']);
  }
}
