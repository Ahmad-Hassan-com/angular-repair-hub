import { inject, Injectable, NgZone, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Backend } from './backend';
import { DB_KEY } from './db';
import { ApiError } from './errors';

const TOKEN_KEY = 'repairhub.token';

/**
 * Client for the in-browser backend. Calls are async with a little latency so the UI
 * is written exactly as it would be against a remote API (loading states, errors,
 * no shared object references), and the token is the only credential sent.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly router = inject(Router);
  private backendInstance?: Promise<Backend>;

  /** Bumped after every successful write here or in another tab; resources re-fetch on it. */
  readonly revision = signal(0);
  readonly token = signal<string | null>(readToken());

  constructor() {
    // Another tab changed the database: refresh whatever this tab is showing.
    const zone = inject(NgZone);
    window.addEventListener('storage', (e) => {
      if (e.key === DB_KEY) zone.run(() => this.revision.update((n) => n + 1));
      if (e.key === TOKEN_KEY) zone.run(() => this.token.set(readToken()));
    });
  }

  /** Read call: resolves with the result or rejects with an ApiError. */
  query<T>(fn: (backend: Backend, token: string) => T): Promise<T> {
    return this.run(fn, false);
  }

  /** Write call: same as query, then notifies listeners so lists refresh. */
  mutate<T>(fn: (backend: Backend, token: string) => T): Promise<T> {
    return this.run(fn, true);
  }

  /** Calls that need no session (sign-in, registration, catalogue). */
  async anonymous<T>(fn: (backend: Backend) => T, write = false): Promise<T> {
    const [backend] = await Promise.all([this.backend(), this.delay()]);
    const result = clone(fn(backend));
    if (write) this.revision.update((n) => n + 1);
    return result;
  }

  setToken(token: string | null): void {
    this.token.set(token);
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Without storage the session lasts until the tab closes.
    }
  }

  /** Wipes the browser database; the next call rebuilds the demo data. */
  resetDemo(): void {
    try {
      localStorage.removeItem(DB_KEY);
    } catch {
      // Nothing stored.
    }
    this.setToken(null);
    this.revision.update((n) => n + 1);
  }

  /** The backend (with validation and the demo seed) is a lazy chunk, loaded on first use. */
  private backend(): Promise<Backend> {
    this.backendInstance ??= import('./server').then((m) => m.createBackend());
    return this.backendInstance;
  }

  private async run<T>(fn: (backend: Backend, token: string) => T, write: boolean): Promise<T> {
    const [backend] = await Promise.all([this.backend(), this.delay()]);
    const token = this.token();
    try {
      if (!token) throw new ApiError('UNAUTHENTICATED', 'Please sign in.');
      const result = clone(fn(backend, token));
      if (write) this.revision.update((n) => n + 1);
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') {
        this.setToken(null);
        this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      }
      throw e;
    }
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 180));
  }
}

/** Results are copied so the UI can never mutate backend state by reference. */
function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}
