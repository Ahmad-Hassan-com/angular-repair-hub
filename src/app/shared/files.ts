import { Component, inject, input, model, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Api } from '../core/api';
import { Toast } from './ui';

const MAX_SOURCE_BYTES = 12_000_000;

/** Downscales a photo in the browser so uploads stay small (and fit in local storage). */
async function compress(
  file: File,
  maxSide = 960,
  quality = 0.72,
): Promise<{ dataUrl: string; mime: string; size: number }> {
  if (file.type === 'application/pdf') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { dataUrl, mime: file.type, size: file.size };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, mime: 'image/jpeg', size: Math.round((dataUrl.length - 23) * 0.75) };
}

/** Loads a stored file through the access-checked API and shows a thumbnail. */
@Component({
  selector: 'app-file-thumb',
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @if (file.value(); as f) {
      @if (f.mime === 'application/pdf') {
        <a
          class="thumb pdf"
          [href]="f.dataUrl"
          target="_blank"
          rel="noopener"
          matTooltip="Open PDF"
        >
          <mat-icon>picture_as_pdf</mat-icon>
        </a>
      } @else {
        <a class="thumb" [href]="f.dataUrl" target="_blank" rel="noopener" aria-label="Open photo">
          <img [src]="f.dataUrl" alt="Uploaded photo" loading="lazy" />
        </a>
      }
    } @else if (file.error()) {
      <span class="thumb pdf" matTooltip="You can't open this file"><mat-icon>lock</mat-icon></span>
    } @else {
      <span class="thumb loading"></span>
    }
  `,
  styles: `
    .thumb {
      width: 88px;
      height: 88px;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-sys-surface-container-high);
      border: 1px solid var(--mat-sys-outline-variant);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .pdf {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class FileThumb {
  private readonly api = inject(Api);
  readonly id = input.required<string>();
  readonly anonymous = input(false);
  protected readonly file = resource({
    params: () => ({ id: this.id(), anonymous: this.anonymous() }),
    // Files uploaded before sign-up can't be fetched yet; show a placeholder for those.
    loader: ({ params }) =>
      params.anonymous && !this.api.token()
        ? Promise.resolve({ mime: 'application/pdf', dataUrl: '#' })
        : this.api.query((b, t) => b.file(t, params.id)),
  });
}

/**
 * Picks photos, compresses them and uploads each to the backend, which re-validates
 * type and size. Emits the uploaded file ids through `ids`.
 */
@Component({
  selector: 'app-photo-upload',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, FileThumb],
  template: `
    <div class="uploader">
      <div class="thumbs">
        @for (id of ids(); track id) {
          <div class="item">
            <app-file-thumb [id]="id" [anonymous]="anonymous()" />
            <button
              mat-icon-button
              type="button"
              class="remove"
              (click)="remove(id)"
              [attr.aria-label]="'Remove file ' + ($index + 1)"
            >
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
        @if (ids().length < max()) {
          <label class="add" [class.busy]="busy()">
            @if (busy()) {
              <mat-spinner diameter="24" />
            } @else {
              <mat-icon aria-hidden="true">{{ pdf() ? 'upload_file' : 'add_a_photo' }}</mat-icon>
              <span>{{ label() }}</span>
            }
            <input
              type="file"
              [accept]="
                pdf()
                  ? 'image/jpeg,image/png,image/webp,application/pdf'
                  : 'image/jpeg,image/png,image/webp'
              "
              multiple
              (change)="pick($event)"
              [disabled]="busy()"
            />
          </label>
        }
      </div>
      <p class="muted small">
        Up to {{ max() }} {{ pdf() ? 'images or PDFs' : 'photos' }}. Photos are resized before
        upload.
      </p>
    </div>
  `,
  styles: `
    .item {
      position: relative;
    }
    .remove {
      position: absolute;
      top: -10px;
      right: -10px;
      background: var(--mat-sys-surface);
      transform: scale(0.75);
      box-shadow: var(--mat-sys-level1);
    }
    .add {
      width: 88px;
      height: 88px;
      border: 2px dashed var(--mat-sys-outline);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      cursor: pointer;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      text-align: center;
      position: relative;
    }
    .add:focus-within {
      outline: 2px solid var(--mat-sys-primary);
    }
    .add input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    p {
      margin: 6px 0 0;
    }
  `,
})
export class PhotoUpload {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  readonly ids = model<string[]>([]);
  readonly max = input(4);
  readonly label = input('Add photo');
  readonly pdf = input(false);
  /** Vendor sign-up uploads documents before an account exists. */
  readonly anonymous = input(false);
  protected readonly busy = signal(false);

  protected async pick(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []).slice(0, this.max() - this.ids().length);
    inputEl.value = '';
    if (!files.length) return;
    this.busy.set(true);
    try {
      for (const file of files) {
        if (file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} is larger than 12 MB.`);
        const payload = await compress(file);
        const { id } = this.anonymous()
          ? await this.api.anonymous((b) => b.uploadFile(null, payload), true)
          : await this.api.mutate((b, t) => b.uploadFile(t, payload));
        this.ids.update((ids) => [...ids, id]);
      }
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(id: string): void {
    this.ids.update((ids) => ids.filter((x) => x !== id));
  }
}
