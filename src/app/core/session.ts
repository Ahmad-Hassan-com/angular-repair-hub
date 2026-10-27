import { computed, effect, inject, Injectable, resource } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Api } from './api';
import { Permission, Role } from './models';

/** The signed-in user, re-fetched whenever the token or data changes. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  private readonly me = resource({
    params: () => ({ token: this.api.token(), rev: this.api.revision() }),
    loader: ({ params }) =>
      params.token ? this.api.query((b, t) => b.me(t)) : Promise.resolve(null),
  });

  readonly user = computed(() => (this.me.hasValue() ? (this.me.value()?.user ?? null) : null));
  readonly vendor = computed(() => (this.me.hasValue() ? this.me.value()?.vendor : undefined));
  readonly addresses = computed(() =>
    this.me.hasValue() ? (this.me.value()?.addresses ?? []) : [],
  );
  readonly role = computed(() => this.user()?.role ?? null);
  readonly loading = computed(() => this.me.isLoading() && !this.me.hasValue());

  constructor() {
    // Signed out in another tab, or the session expired: leave protected pages.
    effect(() => {
      if (!this.api.token() && this.router.url.match(/^\/(customer|vendor|agent|admin|receipt)/)) {
        this.router.navigate(['/login']);
      }
    });
  }

  can(perm: Permission): boolean {
    const u = this.user();
    return (
      !!u && (u.role === 'SUPER_ADMIN' || (u.role === 'STAFF' && u.permissions.includes(perm)))
    );
  }

  /** Waits for the current user to load (used by guards on a cold start). */
  async ready(): Promise<ReturnType<typeof this.user>> {
    if (!this.api.token()) return null;
    try {
      const me = await this.api.query((b, t) => b.me(t));
      return me.user;
    } catch {
      return null;
    }
  }

  async signOut(): Promise<void> {
    const token = this.api.token();
    if (token) await this.api.anonymous((b) => b.logout(token)).catch(() => undefined);
    this.api.setToken(null);
    await this.router.navigate(['/']);
  }
}

export function homeFor(role: Role): string {
  return {
    CUSTOMER: '/customer',
    VENDOR: '/vendor',
    AGENT: '/agent',
    STAFF: '/admin',
    SUPER_ADMIN: '/admin',
  }[role];
}

/** Lets a route through only for the given roles; everyone else goes home or to sign-in. */
export function roleGuard(...roles: Role[]): CanActivateFn {
  return async (_route, state) => {
    const router = inject(Router);
    const user = await inject(Session).ready();
    if (!user) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    return roles.includes(user.role) || router.createUrlTree([homeFor(user.role)]);
  };
}

/** Signed-in users skip the sign-in and registration pages. */
export const guestGuard: CanActivateFn = async () => {
  const user = await inject(Session).ready();
  return user ? inject(Router).createUrlTree([homeFor(user.role)]) : true;
};
