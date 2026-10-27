import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/ui';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, MatButtonModule, EmptyState],
  template: `
    <div class="page">
      <app-empty
        icon="search_off"
        title="Page not found"
        text="The page you're looking for doesn't exist or has moved."
      >
        <a mat-flat-button routerLink="/">Go home</a>
      </app-empty>
    </div>
  `,
})
export class NotFound {}
