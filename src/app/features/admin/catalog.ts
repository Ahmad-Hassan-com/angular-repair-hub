import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { Api } from '../../core/api';
import { Loading, PkrPipe, Toast } from '../../shared/ui';

type Table = 'brands' | 'models' | 'categories' | 'areas';

/** Brands, models, repair categories and service areas. Inactive items stay on old jobs but can't be chosen. */
@Component({
  selector: 'app-admin-catalog',
  imports: [
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    Loading,
    PkrPipe,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Catalogue</h1>
          <p>
            What customers can choose when requesting a repair. Deactivating keeps history intact.
          </p>
        </div>
      </header>
      @if (!data.hasValue()) {
        <app-loading />
      } @else {
        @let d = data.value()!;
        <mat-tab-group animationDuration="0ms">
          <mat-tab label="Repair categories">
            <div class="tab">
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Icon</th>
                      <th>Name</th>
                      <th class="num">From price</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of d.categories; track c.id) {
                      <tr>
                        <td>
                          <mat-icon>{{ c.icon }}</mat-icon>
                        </td>
                        <td>{{ c.name }}</td>
                        <td class="num">{{ c.fromPrice | pkr }}</td>
                        <td>
                          <span class="tone" [class]="c.active ? 'success' : 'neutral'">{{
                            c.active ? 'active' : 'inactive'
                          }}</span>
                        </td>
                        <td>
                          <button
                            mat-button
                            type="button"
                            (click)="
                              save('categories', {
                                id: c.id,
                                name: c.name,
                                icon: c.icon,
                                fromPrice: c.fromPrice,
                                active: !c.active,
                              })
                            "
                          >
                            {{ c.active ? 'Deactivate' : 'Activate' }}
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <form
                class="add row"
                (ngSubmit)="
                  save('categories', {
                    name: cat.name,
                    icon: cat.icon || 'build',
                    fromPrice: +cat.fromPrice,
                  });
                  cat = { name: '', icon: '', fromPrice: 0 }
                "
              >
                <mat-form-field subscriptSizing="dynamic"
                  ><mat-label>New category</mat-label
                  ><input matInput name="n" [(ngModel)]="cat.name"
                /></mat-form-field>
                <mat-form-field subscriptSizing="dynamic"
                  ><mat-label>Material icon name</mat-label
                  ><input matInput name="i" [(ngModel)]="cat.icon" placeholder="build"
                /></mat-form-field>
                <mat-form-field subscriptSizing="dynamic"
                  ><mat-label>From price (Rs)</mat-label
                  ><input matInput type="number" name="p" [(ngModel)]="cat.fromPrice"
                /></mat-form-field>
                <button
                  mat-flat-button
                  type="submit"
                  [disabled]="cat.name.trim().length < 2 || busy()"
                >
                  Add
                </button>
              </form>
            </div>
          </mat-tab>

          <mat-tab label="Brands and models">
            <div class="tab grid-2">
              <section class="panel">
                <h2>Brands</h2>
                @for (b of d.brands; track b.id) {
                  <div class="row item" [class.sel]="brand() === b.id">
                    <button mat-button type="button" (click)="brand.set(b.id)">{{ b.name }}</button>
                    <span class="tone" [class]="b.active ? 'success' : 'neutral'">{{
                      b.active ? 'active' : 'inactive'
                    }}</span>
                    <span class="spacer"></span>
                    <button
                      mat-button
                      type="button"
                      (click)="save('brands', { id: b.id, name: b.name, active: !b.active })"
                    >
                      {{ b.active ? 'Deactivate' : 'Activate' }}
                    </button>
                  </div>
                }
                <form
                  class="add row"
                  (ngSubmit)="save('brands', { name: newBrand }); newBrand = ''"
                >
                  <mat-form-field subscriptSizing="dynamic"
                    ><mat-label>New brand</mat-label
                    ><input matInput name="b" [(ngModel)]="newBrand"
                  /></mat-form-field>
                  <button
                    mat-flat-button
                    type="submit"
                    [disabled]="newBrand.trim().length < 2 || busy()"
                  >
                    Add
                  </button>
                </form>
              </section>
              <section class="panel">
                <h2>Models for {{ brandName() }}</h2>
                @for (m of models(); track m.id) {
                  <div class="row item">{{ m.name }}</div>
                } @empty {
                  <p class="muted">No models yet.</p>
                }
                <form
                  class="add row"
                  (ngSubmit)="save('models', { name: newModel, brandId: brand() }); newModel = ''"
                >
                  <mat-form-field subscriptSizing="dynamic"
                    ><mat-label>New model</mat-label
                    ><input matInput name="m" [(ngModel)]="newModel"
                  /></mat-form-field>
                  <button
                    mat-flat-button
                    type="submit"
                    [disabled]="newModel.trim().length < 2 || !brand() || busy()"
                  >
                    Add
                  </button>
                </form>
              </section>
            </div>
          </mat-tab>

          <mat-tab label="Service areas">
            <div class="tab">
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Area</th>
                      <th>City</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (a of d.areas; track a.id) {
                      <tr>
                        <td>{{ a.name }}</td>
                        <td>{{ a.city }}</td>
                        <td>
                          <span class="tone" [class]="a.active ? 'success' : 'neutral'">{{
                            a.active ? 'active' : 'inactive'
                          }}</span>
                        </td>
                        <td>
                          <button
                            mat-button
                            type="button"
                            (click)="
                              save('areas', {
                                id: a.id,
                                name: a.name,
                                city: a.city,
                                active: !a.active,
                              })
                            "
                          >
                            {{ a.active ? 'Deactivate' : 'Activate' }}
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <form
                class="add row"
                (ngSubmit)="
                  save('areas', { name: area.name, city: area.city }); area = { name: '', city: '' }
                "
              >
                <mat-form-field subscriptSizing="dynamic"
                  ><mat-label>New area</mat-label><input matInput name="a" [(ngModel)]="area.name"
                /></mat-form-field>
                <mat-form-field subscriptSizing="dynamic"
                  ><mat-label>City</mat-label
                  ><input matInput name="c" [(ngModel)]="area.city" placeholder="Lahore"
                /></mat-form-field>
                <button
                  mat-flat-button
                  type="submit"
                  [disabled]="area.name.trim().length < 2 || area.city.trim().length < 2 || busy()"
                >
                  Add
                </button>
              </form>
            </div>
          </mat-tab>
        </mat-tab-group>
      }
    </div>
  `,
  styles: `
    .tab {
      padding: 16px 0;
    }
    .add {
      margin-top: 16px;
    }
    .item {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      padding: 4px 0;
      min-height: 40px;
    }
    .item.sel {
      background: var(--mat-sys-secondary-container);
      border-radius: 8px;
    }
  `,
})
export class AdminCatalog {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly busy = signal(false);
  protected readonly brand = signal('');
  protected cat = { name: '', icon: '', fromPrice: 0 };
  protected area = { name: '', city: '' };
  protected newBrand = '';
  protected newModel = '';

  /** Admins see inactive items too, so read the raw report tables plus the public catalogue. */
  protected readonly data = resource({
    params: () => ({ rev: this.api.revision() }),
    loader: () => this.api.query((b, t) => b.adminCatalog(t)),
  });
  protected readonly models = computed(() =>
    (this.data.value()?.models ?? []).filter((m) => m.brandId === this.brand()),
  );
  protected readonly brandName = computed(
    () =>
      this.data.value()?.brands.find((b) => b.id === this.brand())?.name ?? 'the selected brand',
  );

  protected async save(table: Table, item: Record<string, unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.mutate((b, t) => b.upsertCatalog(t, table, item));
      this.toast.ok('Catalogue updated.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
