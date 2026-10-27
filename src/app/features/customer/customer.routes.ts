import { Routes } from '@angular/router';

const page = (title: string) => `${title} | Repair Hub`;

export const customerRoutes: Routes = [
  {
    path: '',
    title: page('My repairs'),
    loadComponent: () => import('./my-repairs').then((m) => m.MyRepairs),
  },
  {
    path: 'new',
    title: page('Request a repair'),
    loadComponent: () => import('./new-request').then((m) => m.NewRequest),
  },
  {
    path: 'jobs/:id',
    title: page('Repair details'),
    loadComponent: () => import('../jobs/job-detail').then((m) => m.JobDetail),
  },
  {
    path: 'payments',
    title: page('Payments'),
    loadComponent: () => import('./payments').then((m) => m.Payments),
  },
  {
    path: 'support',
    title: page('Support'),
    loadComponent: () => import('../support/support').then((m) => m.Support),
  },
  {
    path: 'profile',
    title: page('Profile'),
    loadComponent: () => import('./profile').then((m) => m.Profile),
  },
];
