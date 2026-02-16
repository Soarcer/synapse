import { t, setLocale, getLocale } from '../index';

describe('i18n', () => {
  it('returns English string for a known key', () => {
    expect(t('app.loading')).toBe('Loading...');
    expect(t('error.retry')).toBe('Try Again');
    expect(t('graph.empty')).toBe('Waiting for agent events...');
  });

  it('returns the key itself for an unknown key', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('returns defaultValue when key is missing and defaultValue is provided', () => {
    expect(t('missing.key', 'fallback text')).toBe('fallback text');
  });

  it('prefers translation over defaultValue when key exists', () => {
    expect(t('app.loading', 'fallback')).toBe('Loading...');
  });

  it('getLocale returns current locale', () => {
    expect(getLocale()).toBe('en');
  });

  it('setLocale is a no-op for unknown locales', () => {
    setLocale('fr');
    expect(getLocale()).toBe('en');
  });
});
