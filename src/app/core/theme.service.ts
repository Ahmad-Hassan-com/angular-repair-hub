import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const THEME_KEY = 'repairhub.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<Theme>(
    (localStorage.getItem(THEME_KEY) as Theme | null) ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );

  constructor() {
    effect(() => {
      const theme = this.theme();
      // Material's M3 tokens are built with light-dark(), so flipping color-scheme re-themes everything.
      this.document.documentElement.classList.toggle('dark-theme', theme === 'dark');
      localStorage.setItem(THEME_KEY, theme);
    });
  }

  toggle(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
}
