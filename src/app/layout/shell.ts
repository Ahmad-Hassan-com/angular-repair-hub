import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject, resource, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Api } from '../core/api';
import { Permission, Role } from '../core/models';
import { Session } from '../core/session';
import { ThemeService } from '../core/theme.service';
import { Notification } from '../core/models';
import { PkDatePipe } from '../shared/ui';
import { DemoBanner } from './demo-banner';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
  perm?: Permission;
}

const NAV: Record<Role, NavItem[]> = {
  CUSTOMER: [
    { path: '/customer', label: 'My repairs', icon: 'home_repair_service', exact: true },
    { path: '/customer/new', label: 'Request a repair', icon: 'add_circle' },
    { path: '/customer/payments', label: 'Payments & receipts', icon: 'receipt_long' },
    { path: '/customer/support', label: 'Support', icon: 'support_agent' },
    { path: '/customer/profile', label: 'Profile', icon: 'person' },
  ],
  VENDOR: [
    { path: '/vendor', label: 'Dashboard', icon: 'dashboard', exact: true },
    { path: '/vendor/marketplace', label: 'Available jobs', icon: 'work' },
    { path: '/vendor/jobs', label: 'My jobs', icon: 'build' },
    { path: '/vendor/tasks', label: 'Pickups & deliveries', icon: 'local_shipping' },
    { path: '/vendor/earnings', label: 'Earnings', icon: 'account_balance_wallet' },
    { path: '/vendor/reviews', label: 'Reviews', icon: 'star' },
    { path: '/vendor/support', label: 'Support', icon: 'support_agent' },
    { path: '/vendor/settings', label: 'Business settings', icon: 'storefront' },
  ],
  AGENT: [{ path: '/agent', label: 'My tasks', icon: 'local_shipping', exact: true }],
  STAFF: [],
  SUPER_ADMIN: [],
};

const ADMIN_NAV: NavItem[] = [
  { path: '/admin', label: 'Overview', icon: 'insights', exact: true, perm: 'reports.view' },
  { path: '/admin/jobs', label: 'Repair jobs', icon: 'build', perm: 'jobs.view' },
  {
    path: '/admin/deliveries',
    label: 'Pickup & delivery',
    icon: 'local_shipping',
    perm: 'deliveries.manage',
  },
  { path: '/admin/vendors', label: 'Vendors', icon: 'storefront', perm: 'vendors.manage' },
  { path: '/admin/customers', label: 'Customers', icon: 'group', perm: 'customers.manage' },
  {
    path: '/admin/finance',
    label: 'Payments & settlements',
    icon: 'payments',
    perm: 'payments.verify',
  },
  { path: '/admin/reports', label: 'Reports', icon: 'bar_chart', perm: 'reports.view' },
  {
    path: '/admin/support',
    label: 'Complaints & reviews',
    icon: 'support_agent',
    perm: 'complaints.manage',
  },
  { path: '/admin/catalog', label: 'Catalogue', icon: 'category', perm: 'catalog.manage' },
  {
    path: '/admin/staff',
    label: 'Staff & permissions',
    icon: 'admin_panel_settings',
    perm: 'staff.manage',
  },
  { path: '/admin/settings', label: 'Settings', icon: 'settings', perm: 'settings.manage' },
  { path: '/admin/audit', label: 'Audit log', icon: 'history', perm: 'audit.view' },
];

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  STAFF: 'Operations',
  VENDOR: 'Vendor',
  CUSTOMER: 'Customer',
  AGENT: 'Delivery agent',
};

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatBadgeModule,
    MatTooltipModule,
    MatDividerModule,
    PkDatePipe,
    DemoBanner,
  ],
  template: `
    <app-demo-banner />
    <mat-sidenav-container class="container">
      <mat-sidenav
        #drawer
        [mode]="mobile() ? 'over' : 'side'"
        [opened]="!mobile()"
        class="sidenav"
        [attr.role]="mobile() ? 'dialog' : 'navigation'"
        aria-label="Main navigation"
      >
        <a class="brand plain" [routerLink]="home()">
          <span class="logo"><mat-icon>build_circle</mat-icon></span>
          <span>Repair Hub</span>
        </a>
        <mat-nav-list>
          @for (item of nav(); track item.path) {
            <a
              mat-list-item
              [routerLink]="item.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: !!item.exact }"
              ariaCurrentWhenActive="page"
            >
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
          }
        </mat-nav-list>
        @if (session.vendor(); as v) {
          <div class="vendor-state">
            <span class="dot" [class.on]="v.available && v.status === 'APPROVED'"></span>
            {{
              v.status === 'APPROVED'
                ? v.available
                  ? 'Accepting jobs'
                  : 'Not accepting jobs'
                : 'Approval ' + v.status.toLowerCase()
            }}
          </div>
        }
      </mat-sidenav>

      <mat-sidenav-content>
        <mat-toolbar class="toolbar">
          @if (mobile()) {
            <button mat-icon-button type="button" (click)="drawer.toggle()" aria-label="Open menu">
              <mat-icon>menu</mat-icon>
            </button>
          }
          <span class="role-label">{{ roleLabel() }}</span>
          <span class="spacer"></span>
          <button
            mat-icon-button
            type="button"
            (click)="theme.toggle()"
            [matTooltip]="isDark() ? 'Light mode' : 'Dark mode'"
            [attr.aria-label]="isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <mat-icon>{{ isDark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
          </button>
          <button
            mat-icon-button
            type="button"
            [matMenuTriggerFor]="notifMenu"
            [attr.aria-label]="'Notifications, ' + unread() + ' unread'"
            matTooltip="Notifications"
          >
            <mat-icon
              [matBadge]="unread() > 9 ? '9+' : unread()"
              [matBadgeHidden]="unread() === 0"
              matBadgeSize="small"
              aria-hidden="true"
              >notifications</mat-icon
            >
          </button>
          <button mat-button type="button" [matMenuTriggerFor]="userMenu" class="user-btn">
            <span class="avatar" aria-hidden="true">{{ initials() }}</span>
            <span class="user-name">{{ session.user()?.name }}</span>
          </button>
        </mat-toolbar>

        <mat-menu #notifMenu="matMenu" xPosition="before" class="notif-menu">
          <div class="notif-head" (click)="$event.stopPropagation()" role="presentation">
            <strong>Notifications</strong>
            @if (unread()) {
              <button mat-button type="button" (click)="markAllRead()">Mark all read</button>
            }
          </div>
          @for (n of notifications.value() ?? []; track n.id) {
            <button
              mat-menu-item
              type="button"
              (click)="open(n)"
              [class.unread]="!n.read"
              class="notif"
            >
              <span class="n-title">{{ n.title }}</span>
              <span class="n-body">{{ n.body }}</span>
              <span class="n-time">{{ n.at | pkDate }}</span>
            </button>
          } @empty {
            <p class="notif-empty muted">You're all caught up.</p>
          }
        </mat-menu>

        <mat-menu #userMenu="matMenu" xPosition="before">
          <div class="menu-user" role="presentation">
            <strong>{{ session.user()?.name }}</strong>
            <span class="muted small">{{ session.user()?.email }}</span>
          </div>
          <mat-divider />
          @if (profileLink(); as link) {
            <a mat-menu-item [routerLink]="link"><mat-icon>manage_accounts</mat-icon>Account</a>
          }
          <button mat-menu-item type="button" (click)="session.signOut()">
            <mat-icon>logout</mat-icon>Sign out
          </button>
        </mat-menu>

        <main id="main">
          <router-outlet />
        </main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly session = inject(Session);
  protected readonly theme = inject(ThemeService);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly drawer = viewChild.required<MatSidenav>('drawer');

  protected readonly mobile = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 959px)')
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  protected readonly isDark = computed(() => this.theme.theme() === 'dark');

  protected readonly nav = computed(() => {
    const role = this.session.role();
    if (!role) return [];
    if (role === 'SUPER_ADMIN' || role === 'STAFF')
      return ADMIN_NAV.filter((i) => !i.perm || this.session.can(i.perm));
    return NAV[role];
  });
  protected readonly home = computed(() => this.nav()[0]?.path ?? '/');
  protected readonly roleLabel = computed(() => {
    const u = this.session.user();
    if (!u) return '';
    return u.role === 'VENDOR' ? (this.session.vendor()?.shopName ?? 'Vendor') : ROLE_LABEL[u.role];
  });
  protected readonly initials = computed(() =>
    (this.session.user()?.name ?? '?')
      .split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
  );
  protected readonly profileLink = computed(() => {
    const role = this.session.role();
    return role === 'CUSTOMER'
      ? '/customer/profile'
      : role === 'VENDOR'
        ? '/vendor/settings'
        : null;
  });

  protected readonly notifications = resource({
    params: () => ({ rev: this.api.revision(), token: this.api.token() }),
    loader: ({ params }) =>
      params.token ? this.api.query((b, t) => b.notifications(t)) : Promise.resolve([]),
  });
  protected readonly unread = computed(
    () => (this.notifications.value() ?? []).filter((n) => !n.read).length,
  );

  constructor() {
    // Close the drawer after navigating on small screens.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      if (this.mobile()) this.drawer().close();
    });
  }

  protected async open(n: Notification): Promise<void> {
    if (!n.read) await this.api.mutate((b, t) => b.markNotificationsRead(t, [n.id]));
    if (n.link) this.router.navigateByUrl(n.link);
  }

  protected markAllRead(): void {
    this.api.mutate((b, t) => b.markNotificationsRead(t));
  }
}
