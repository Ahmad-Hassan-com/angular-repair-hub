import { Routes } from '@angular/router';
import { guestGuard, roleGuard } from './core/session';

const page = (title: string) => `${title} | Repair Hub`;

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Repair Hub: phone repair with pickup and delivery',
    loadComponent: () => import('./features/public/landing').then((m) => m.Landing),
  },
  {
    path: 'login',
    title: page('Sign in'),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/public/login').then((m) => m.Login),
  },
  {
    path: 'register',
    title: page('Create account'),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/public/register').then((m) => m.Register),
  },
  {
    path: 'register/vendor',
    title: page('Register your shop'),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/public/register-vendor').then((m) => m.RegisterVendor),
  },
  {
    path: 'receipt/:id',
    title: page('Receipt'),
    canActivate: [roleGuard('CUSTOMER', 'VENDOR', 'SUPER_ADMIN', 'STAFF')],
    loadComponent: () => import('./features/jobs/receipt').then((m) => m.Receipt),
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: 'customer',
        canActivate: [roleGuard('CUSTOMER')],
        loadChildren: () =>
          import('./features/customer/customer.routes').then((m) => m.customerRoutes),
      },
      {
        path: 'vendor',
        canActivate: [roleGuard('VENDOR')],
        loadChildren: () => import('./features/vendor/vendor.routes').then((m) => m.vendorRoutes),
      },
      {
        path: 'agent',
        canActivate: [roleGuard('AGENT')],
        children: [
          {
            path: '',
            title: page('My tasks'),
            loadComponent: () => import('./features/vendor/tasks').then((m) => m.Tasks),
          },
          {
            path: 'jobs/:id',
            title: page('Job'),
            loadComponent: () => import('./features/jobs/job-detail').then((m) => m.JobDetail),
          },
        ],
      },
      {
        path: 'admin',
        canActivate: [roleGuard('SUPER_ADMIN', 'STAFF')],
        loadChildren: () => import('./features/admin/admin.routes').then((m) => m.adminRoutes),
      },
    ],
  },
  {
    path: '**',
    title: page('Page not found'),
    loadComponent: () => import('./features/public/not-found').then((m) => m.NotFound),
  },
];
