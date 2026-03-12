// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePush } from '../usePush';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigator APIs
const mockSubscription = {
  endpoint: 'https://fcm.example.com/test',
  getKey: vi.fn((name: string) => {
    if (name === 'p256dh') return new ArrayBuffer(65);
    if (name === 'auth') return new ArrayBuffer(16);
    return null;
  }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

const mockPushManager = {
  getSubscription: vi.fn().mockResolvedValue(null),
  subscribe: vi.fn().mockResolvedValue(mockSubscription),
};

const mockRegistration = {
  pushManager: mockPushManager,
};

describe('usePush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ publicKey: 'test-key', enabled: true }),
    });

    // Default: SW supported, permission default
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue(mockRegistration),
        ready: Promise.resolve(mockRegistration),
        getRegistration: vi.fn().mockResolvedValue(mockRegistration),
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window, 'Notification', {
      value: { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') },
      writable: true,
      configurable: true,
    });
  });

  it('detects unsupported state when serviceWorker is missing', () => {
    // Delete the property so 'serviceWorker' in navigator === false
    const saved = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    // @ts-expect-error — deleting from navigator for test
    delete (navigator as Record<string, unknown>).serviceWorker;
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('unsupported');
    // Restore for subsequent tests
    if (saved) Object.defineProperty(navigator, 'serviceWorker', saved);
  });

  it('detects denied permission', () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'denied' },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('denied');
  });

  it('detects default (not yet asked) state', () => {
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('default');
  });
});
