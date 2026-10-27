import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { Api } from '../../core/api';

const page = (title: string) => `${title} | Repair Hub`;

/** Pending, rejected or suspended vendors only see their dashboard, settings and support. */
const approvedVendor: CanActivateFn = async () => {
  const router = inject(Router);
  try {
    const me = await inject(Api).query((b, t) => b.me(t));
    return me.vendor?.status === 'APPROVED' || router.createUrlTree(['/vendor']);
  } catch {
    return router.createUrlTree(['/login']);
  }
};

export const vendorRoutes: Routes = [
  {
    path: '',
    title: page('Vendor dashboard'),
    loadComponent: () => import('./dashboard').then((m) => m.VendorDashboard),
  },
  {
    path: 'marketplace',
    title: page('Available jobs'),
    canActivate: [approvedVendor],
    loadComponent: () => import('./marketplace').then((m) => m.Marketplace),
  },
  {
    path: 'jobs',
    title: page('My jobs'),
    loadComponent: () => import('./my-jobs').then((m) => m.MyJobs),
  },
  {
    path: 'jobs/:id',
    title: page('Job'),
    loadComponent: () => import('../jobs/job-detail').then((m) => m.JobDetail),
  },
  {
    path: 'tasks',
    title: page('Pickups & deliveries'),
    loadComponent: () => import('./tasks').then((m) => m.Tasks),
  },
  {
    path: 'earnings',
    title: page('Earnings'),
    loadComponent: () => import('./earnings').then((m) => m.Earnings),
  },
  {
    path: 'reviews',
    title: page('Reviews'),
    loadComponent: () => import('./reviews').then((m) => m.VendorReviews),
  },
  {
    path: 'support',
    title: page('Support'),
    loadComponent: () => import('../support/support').then((m) => m.Support),
  },
  {
    path: 'settings',
    title: page('Business settings'),
    loadComponent: () => import('./settings').then((m) => m.VendorSettings),
  },
];
