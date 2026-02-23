// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import en from './en';

type Locale = 'en';

let currentLocale: Locale = 'en';
const locales: Record<Locale, Record<string, string>> = { en };

/**
 * Get a translated string by key.
 * Returns the translation if found, otherwise the defaultValue or the key itself.
 */
export function t(key: string, defaultValue?: string): string {
  const translations = locales[currentLocale];
  return translations[key] ?? defaultValue ?? key;
}

/**
 * Set the active locale. No-op if locale is not loaded.
 */
export function setLocale(locale: string): void {
  if (locale in locales) {
    currentLocale = locale as Locale;
  }
}

/**
 * Get the current locale identifier.
 */
export function getLocale(): string {
  return currentLocale;
}
