import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { Api } from '../../core/api';
import { Permission } from '../../core/models';

const page = (title: string) => `${title} | Repair Hub admin`;

/** Staff only reach pages for permissions they hold. The backend enforces the same rule on every call. */
function can(perm: Permission): CanActivateFn {
  return async () => {
    const router = inject(Router);
    try {
      const { user } = await inject(Api).query((b, t) => b.me(t));
      if (user.role === 'SUPER_ADMIN' || user.permissions.includes(perm)) return true;
      // Send staff to the first page they can use instead of a dead end.
      return perm === 'reports.view' && user.permissions.includes('jobs.view')
        ? router.createUrlTree(['/admin/jobs'])
        : router.createUrlTree(['/admin/no-access']);
    } catch {
      return router.createUrlTree(['/login']);
    }
  };
}

export const adminRoutes: Routes = [
  {
    path: '',
    title: page('Overview'),
    canActivate: [can('reports.view')],
    loadComponent: () => import('./overview').then((m) => m.Overview),
  },
  {
    path: 'jobs',
    title: page('Repair jobs'),
    canActivate: [can('jobs.view')],
    loadComponent: () => import('./jobs').then((m) => m.AdminJobs),
  },
  {
    path: 'jobs/:id',
    title: page('Job'),
    canActivate: [can('jobs.view')],
    loadComponent: () => import('../jobs/job-detail').then((m) => m.JobDetail),
  },
  {
    path: 'deliveries',
    title: page('Pickup and delivery'),
    canActivate: [can('deliveries.manage')],
    data: { admin: true },
    loadComponent: () => import('../vendor/tasks').then((m) => m.Tasks),
  },
  {
    path: 'vendors',
    title: page('Vendors'),
    canActivate: [can('vendors.manage')],
    loadComponent: () => import('./vendors').then((m) => m.AdminVendors),
  },
  {
    path: 'customers',
    title: page('Customers'),
    canActivate: [can('customers.manage')],
    loadComponent: () => import('./customers').then((m) => m.AdminCustomers),
  },
  {
    path: 'finance',
    title: page('Payments and settlements'),
    canActivate: [can('payments.verify')],
    loadComponent: () => import('./finance').then((m) => m.AdminFinance),
  },
  {
    path: 'reports',
    title: page('Reports'),
    canActivate: [can('reports.view')],
    loadComponent: () => import('./reports').then((m) => m.AdminReports),
  },
  {
    path: 'support',
    title: page('Complaints and reviews'),
    canActivate: [can('complaints.manage')],
    loadComponent: () => import('./support').then((m) => m.AdminSupport),
  },
  {
    path: 'catalog',
    title: page('Catalogue'),
    canActivate: [can('catalog.manage')],
    loadComponent: () => import('./catalog').then((m) => m.AdminCatalog),
  },
  {
    path: 'staff',
    title: page('Staff and permissions'),
    canActivate: [can('staff.manage')],
    loadComponent: () => import('./staff').then((m) => m.AdminStaff),
  },
  {
    path: 'settings',
    title: page('Settings'),
    canActivate: [can('settings.manage')],
    loadComponent: () => import('./settings').then((m) => m.AdminSettings),
  },
  {
    path: 'audit',
    title: page('Audit log'),
    canActivate: [can('audit.view')],
    loadComponent: () => import('./audit').then((m) => m.AdminAudit),
  },
  {
    path: 'no-access',
    title: page('No access'),
    loadComponent: () => import('../../shared/ui').then((m) => m.NoAccess),
  },
];
