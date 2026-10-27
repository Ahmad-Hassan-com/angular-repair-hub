import { Component, inject, Injectable } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';

interface ConfirmData {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
  /** When set, ask for text (a reason) and return it. */
  prompt?: { label: string; required: boolean; minLength?: number };
}

@Component({
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, FormsModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
      @if (data.prompt) {
        <mat-form-field class="full-width" subscriptSizing="dynamic">
          <mat-label>{{ data.prompt.label }}</mat-label>
          <textarea matInput rows="3" [(ngModel)]="text" maxlength="500" cdkFocusInitial></textarea>
          @if (tooShort()) {
            <mat-hint>At least {{ min }} characters.</mat-hint>
          }
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [class.danger]="data.danger"
        [disabled]="tooShort()"
        (click)="ref.close(data.prompt ? text.trim() : true)"
      >
        {{ data.confirm }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    p {
      margin-top: 0;
    }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<ConfirmDialog, string | boolean>);
  protected text = '';
  protected readonly min = this.data.prompt?.minLength ?? (this.data.prompt?.required ? 3 : 0);

  protected tooShort(): boolean {
    return !!this.data.prompt && this.text.trim().length < this.min;
  }
}

@Injectable({ providedIn: 'root' })
export class Dialogs {
  private readonly dialog = inject(MatDialog);

  async confirm(
    title: string,
    message: string,
    confirm = 'Confirm',
    danger = false,
  ): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialog, {
      data: { title, message, confirm, danger },
      width: '440px',
      maxWidth: '94vw',
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /** Resolves with the entered text, or null if cancelled. */
  async prompt(
    title: string,
    message: string,
    label: string,
    confirm = 'Submit',
    required = true,
    danger = false,
  ): Promise<string | null> {
    const ref = this.dialog.open(ConfirmDialog, {
      data: { title, message, confirm, danger, prompt: { label, required } },
      width: '480px',
      maxWidth: '94vw',
    });
    const result = await firstValueFrom(ref.afterClosed());
    return typeof result === 'string' ? result : null;
  }
}
