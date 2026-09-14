import type { Locale } from './types';

/** Locale-aware number/time formatters. Centralised here so new call sites
 *  don't reinvent Intl every time, and the locale choice is read from the
 *  same zustand store. */
export function formatCount(locale: Locale, n: number): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatTime(locale: Locale, d: Date | number): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
}
