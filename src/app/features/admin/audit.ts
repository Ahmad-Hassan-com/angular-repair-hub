import { Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../../core/api';
import { downloadCsv, pkDay, toCsv } from '../../core/reports';
import { EmptyState, Loading, PkDatePipe } from '../../shared/ui';

@Component({
  selector: 'app-admin-audit',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    PkDatePipe,
    Loading,
    EmptyState,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1>Audit log</h1>
          <p>Every important action, who did it and when. Entries can't be edited or deleted.</p>
        </div>
        <button mat-stroked-button type="button" (click)="export()">
          <mat-icon>download</mat-icon>Export CSV
        </button>
      </header>
      <div class="toolbar-filters">
        <mat-form-field class="search" subscriptSizing="dynamic">
          <mat-label>Search</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
            placeholder="Action, user, record id"
          />
        </mat-form-field>
      </div>
      @if (!log.hasValue()) {
        <app-loading />
      } @else if (!log.value()!.length) {
        <div class="panel"><app-empty icon="history" title="No matching entries" /></div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Time (PKT)</th>
                <th>Who</th>
                <th>Action</th>
                <th>Record</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              @for (a of log.value(); track a.id) {
                <tr>
                  <td class="small">{{ a.at | pkDate: 'long' }}</td>
                  <td>{{ a.actorName }}</td>
                  <td class="mono small">{{ a.action }}</td>
                  <td class="mono small">{{ a.entity }}:{{ a.entityId }}</td>
                  <td class="small">{{ a.detail }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted small">Showing the latest {{ log.value()!.length }} entries.</p>
      }
    </div>
  `,
})
export class AdminAudit {
  private readonly api = inject(Api);
  protected readonly search = signal('');
  protected readonly log = resource({
    params: () => ({ q: this.search(), rev: this.api.revision() }),
    loader: ({ params }) => this.api.query((b, t) => b.auditLog(t, params.q)),
  });

  protected export(): void {
    downloadCsv(
      `audit-log-${pkDay(new Date())}.csv`,
      toCsv(this.log.value() ?? [], [
        { header: 'Time (UTC)', value: (a) => a.at },
        { header: 'Who', value: (a) => a.actorName },
        { header: 'Action', value: (a) => a.action },
        { header: 'Entity', value: (a) => a.entity },
        { header: 'Record', value: (a) => a.entityId },
        { header: 'Detail', value: (a) => a.detail },
      ]),
    );
  }
}
