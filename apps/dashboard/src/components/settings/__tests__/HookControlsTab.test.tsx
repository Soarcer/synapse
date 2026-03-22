// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

vi.mock('../QRCodePanel', () => ({
  QRCodePanel: () => <div data-testid="qr-stub">QR stub</div>,
}));

vi.mock('../../../store/agentStore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, projectCwd: '/fake/project' };
});

import { HookControlsTab } from '../HookControlsTab';

/** Mock fetch to return hook-server status and hook-config in sequence. */
function mockFetchResponses(opts: {
  hookServerRunning?: boolean;
  observation?: boolean;
  remoteApproval?: boolean;
  configError?: boolean;
}) {
  const {
    hookServerRunning = true,
    observation = false,
    remoteApproval = false,
    configError = false,
  } = opts;

  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/hook-server/status')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ running: hookServerRunning, port: 27247, pending: 0 }),
      });
    }
    if (url.includes('/api/hook-config')) {
      if (configError) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'No .claude/ directory' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ observation, remoteApproval, cwd: '/fake/project' }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
}

describe('HookControlsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('renders Hook Controls heading', () => {
    mockFetchResponses({});
    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/hook controls/i)).toBeTruthy();
  });

  it('shows loading state initially', () => {
    mockFetchResponses({});
    render(<HookControlsTab open onClose={() => {}} />);
    // Should show Hook Setup section header while loading
    expect(screen.getByText(/hook setup/i)).toBeTruthy();
  });

  it('shows toggle rows after loading', async () => {
    mockFetchResponses({ observation: true, remoteApproval: false });
    render(<HookControlsTab open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/observation hooks/i)).toBeTruthy();
      expect(screen.getByText(/remote approval/i)).toBeTruthy();
    });
  });

  it('shows permissions.allow bypass note', () => {
    mockFetchResponses({});
    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/permissions\.allow/)).toBeTruthy();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<HookControlsTab open={false} onClose={() => {}} />);
    expect(container.children.length).toBe(0);
  });

  it('shows error state when config fetch fails', async () => {
    mockFetchResponses({ configError: true });
    render(<HookControlsTab open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/no \.claude\/ directory/i)).toBeTruthy();
    });
  });
});
