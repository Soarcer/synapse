// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Features } from '@synapse-ai/core';
import { render, screen, cleanup } from '@testing-library/react';
import { useRemoteDevStore } from '../../../store/remoteDevStore';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

// Must import after mocks
import { RemoteDevChat } from '../RemoteDevChat';

const initialState = useRemoteDevStore.getState();

function resetStore() {
  useRemoteDevStore.setState({
    ...initialState,
    messages: [],
    pendingQuestion: null,
    quickActions: [],
    status: 'idle',
  });
}

beforeEach(() => {
  resetStore();
  cleanup();
});

describe.skipIf(!Features.remoteDevChat)('RemoteDevChat', () => {
  it('shows empty state when idle with no messages', () => {
    render(<RemoteDevChat />);
    expect(screen.getByText('/remote-dev')).toBeTruthy();
  });

  it('renders claude messages', () => {
    useRemoteDevStore.setState({
      messages: [{ id: '1', role: 'claude', text: 'Added sticky header.', timestamp: 1000 }],
      status: 'waiting',
      pendingQuestion: {
        id: 'p1',
        tool_name: 'AskUserQuestion',
        tool_input_preview: '',
        createdAt: 1000,
        expiresAt: 2000,
      },
      quickActions: [],
    });
    render(<RemoteDevChat />);
    expect(screen.getByText('Added sticky header.')).toBeTruthy();
  });

  it('renders quick action buttons when waiting', () => {
    useRemoteDevStore.setState({
      messages: [],
      status: 'waiting',
      pendingQuestion: {
        id: 'p1',
        tool_name: 'AskUserQuestion',
        tool_input_preview: '',
        createdAt: 1000,
        expiresAt: 2000,
      },
      quickActions: ['Run tests', 'Build'],
    });
    render(<RemoteDevChat />);
    expect(screen.getByText('Run tests')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('disables input when not waiting', () => {
    useRemoteDevStore.setState({
      status: 'working',
      messages: [],
      pendingQuestion: null,
      quickActions: [],
    });
    render(<RemoteDevChat />);
    const input = screen.getByPlaceholderText(/type instruction/i);
    expect((input as HTMLInputElement).disabled).toBe(true);
  });

  it('shows working indicator when status is working', () => {
    useRemoteDevStore.setState({
      status: 'working',
      messages: [],
      pendingQuestion: null,
      quickActions: [],
    });
    render(<RemoteDevChat />);
    expect(screen.getByText('Working...')).toBeTruthy();
  });

  it('renders error messages with error styling', () => {
    useRemoteDevStore.setState({
      messages: [
        { id: '1', role: 'claude', text: 'Build failed.', timestamp: 1000, isError: true },
      ],
      status: 'waiting',
      pendingQuestion: {
        id: 'p1',
        tool_name: 'AskUserQuestion',
        tool_input_preview: '',
        createdAt: 1000,
        expiresAt: 2000,
      },
      quickActions: [],
    });
    render(<RemoteDevChat />);
    const msg = screen.getByText('Build failed.');
    expect(msg.closest('[data-error]')?.getAttribute('data-error')).toBe('true');
  });
});
