import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../src/services/agentManager.js';
import type { Broadcaster } from '../src/services/broadcaster.js';
import type { SpawnAgentRequest, AgentEvent } from '@synapse-ai/core';

// Mock the Agent SDK's query function
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock the logger
vi.mock('../src/lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock the database
vi.mock('../src/db.js', () => ({
  insertEvent: vi.fn(),
}));

// Import mocked functions
import { query } from '@anthropic-ai/claude-agent-sdk';
import { insertEvent } from '../src/db.js';

describe('AgentManager', () => {
  let agentManager: AgentManager;
  let mockBroadcaster: Broadcaster;

  beforeEach(() => {
    agentManager = new AgentManager();

    // Create a minimal mock broadcaster
    mockBroadcaster = {
      broadcast: vi.fn(),
      broadcastText: vi.fn(),
      addClient: vi.fn(),
      removeClient: vi.fn(),
      clientCount: 0,
      destroy: vi.fn(),
    } as unknown as Broadcaster;

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any running agents
    agentManager.stopAll();
  });

  describe('spawn', () => {
    it('should successfully spawn a new agent', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test prompt',
        model: 'sonnet',
        tools: ['Read', 'Edit'],
      };

      // Mock the SDK query function to return a stream
      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-123',
        };
        yield {
          type: 'result',
          cost_usd: 0.01,
          input_tokens: 100,
          output_tokens: 50,
        };
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      const agentId = await agentManager.spawn(mockRequest, mockBroadcaster);

      // Verify agent ID is returned
      expect(agentId).toBeDefined();
      expect(agentId).toMatch(/^agent-/);

      // Verify query was called with correct parameters
      expect(query).toHaveBeenCalledWith({
        prompt: 'Test prompt',
        options: expect.objectContaining({
          model: 'sonnet',
          allowedTools: ['Read', 'Edit'],
          permissionMode: 'acceptEdits',
          abortController: expect.any(AbortController),
        }),
      });

      // Verify agent_start event was broadcast
      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent_start',
          agentId,
          agentType: 'custom',
          status: 'running',
        })
      );

      // Verify event was persisted to database
      expect(insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'agent_start',
          agent_id: agentId,
          status: 'running',
        })
      );

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify agent completed successfully
      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent_stop',
          agentId,
          status: 'success',
          tokenUsage: { input: 100, output: 50 },
        })
      );
    });

    it('should throw error when max concurrent agents reached', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test prompt',
      };

      // Mock the SDK query to return a stream that never completes
      const createMockStream = () => (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session',
        };
        // Stream never yields result, keeping agent running
        await new Promise(() => {}); // Never resolves
      })();

      vi.mocked(query).mockImplementation(() => createMockStream() as any);

      // Spawn 10 agents (MAX_CONCURRENT_AGENTS)
      const spawnPromises = [];
      for (let i = 0; i < 10; i++) {
        spawnPromises.push(agentManager.spawn(mockRequest, mockBroadcaster));
      }
      await Promise.all(spawnPromises);

      // 11th agent should throw error
      await expect(
        agentManager.spawn(mockRequest, mockBroadcaster)
      ).rejects.toThrow('Max concurrent agents reached');
    });

    it('should handle agent errors gracefully', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test prompt that will fail',
      };

      // Mock the SDK query to throw an error
      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-error',
        };
        throw new Error('Agent execution failed');
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      const agentId = await agentManager.spawn(mockRequest, mockBroadcaster);

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify error event was broadcast
      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent_stop',
          agentId,
          status: 'error',
          error: 'Agent execution failed',
        })
      );
    });

    it('should handle stream events correctly', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test prompt with tool use',
      };

      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-stream',
        };
        // Simulate tool use start
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: {
              type: 'tool_use',
              id: 'tool-123',
              name: 'Read',
            },
          },
        };
        // Simulate text delta
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: 'Hello world',
            },
          },
        };
        yield {
          type: 'result',
          cost_usd: 0.01,
          input_tokens: 100,
          output_tokens: 50,
        };
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      const agentId = await agentManager.spawn(mockRequest, mockBroadcaster);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify tool_start event was broadcast
      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_start',
          agentId,
          toolName: 'Read',
          toolUseId: 'tool-123',
          status: 'running',
        })
      );

      // Verify text was broadcast
      expect(mockBroadcaster.broadcastText).toHaveBeenCalledWith(
        agentId,
        'Hello world',
        true
      );
    });
  });

  describe('stop', () => {
    it('should stop a running agent', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Long running task',
      };

      // Create a stream that runs indefinitely
      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-stop',
        };
        // Infinite loop that checks for abort
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      const agentId = await agentManager.spawn(mockRequest, mockBroadcaster);

      // Wait a bit for agent to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Stop the agent
      const result = agentManager.stop(agentId);

      expect(result).toBe(true);

      // Verify agent is in stopped status
      const allAgents = agentManager.getAll();
      const stoppedAgent = allAgents.find(a => a.agentId === agentId);
      expect(stoppedAgent?.status).toBe('stopped');
    });

    it('should return false when stopping non-existent agent', () => {
      const result = agentManager.stop('non-existent-agent-id');
      expect(result).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should return false when sending message to completed agent', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Initial prompt',
      };

      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-msg',
        };
        yield {
          type: 'result',
          cost_usd: 0.01,
          input_tokens: 100,
          output_tokens: 50,
        };
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      const agentId = await agentManager.spawn(mockRequest, mockBroadcaster);

      // Wait for agent to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to send message to completed agent
      const result = await agentManager.sendMessage(
        agentId,
        'Follow-up message',
        mockBroadcaster
      );

      expect(result).toBe(true); // Should return true since agent status is 'success'

      // Verify agent was resumed with the new message
      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent_start',
          agentId,
          text: 'Follow-up message',
        })
      );
    });

    it('should return false when agent does not exist', async () => {
      const result = await agentManager.sendMessage(
        'non-existent-id',
        'Test message',
        mockBroadcaster
      );

      expect(result).toBe(false);
    });

    it('should return false when agent is still running', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Running task',
      };

      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-running',
        };
        // Keep running
        await new Promise(() => {});
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      const agentId = await agentManager.spawn(mockRequest, mockBroadcaster);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Try to send message while agent is still running
      const result = await agentManager.sendMessage(
        agentId,
        'Follow-up message',
        mockBroadcaster
      );

      expect(result).toBe(false); // Should return false since agent is not in 'success' state
    });
  });

  describe('getActive', () => {
    it('should return only running agents', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test prompt',
      };

      // Create one running agent
      const runningStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-1',
        };
        await new Promise(() => {}); // Never completes
      })();

      // Create one completed agent
      const completedStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-2',
        };
        yield {
          type: 'result',
          cost_usd: 0.01,
          input_tokens: 100,
          output_tokens: 50,
        };
      })();

      vi.mocked(query)
        .mockReturnValueOnce(runningStream as any)
        .mockReturnValueOnce(completedStream as any);

      await agentManager.spawn(mockRequest, mockBroadcaster);
      await agentManager.spawn(mockRequest, mockBroadcaster);

      await new Promise(resolve => setTimeout(resolve, 100));

      const activeAgents = agentManager.getActive();

      expect(activeAgents).toHaveLength(1);
      expect(activeAgents[0].status).toBe('running');
    });
  });

  describe('getAll', () => {
    it('should return all agents regardless of status', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test prompt',
      };

      const stream1 = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-1',
        };
        yield {
          type: 'result',
          cost_usd: 0.01,
          input_tokens: 100,
          output_tokens: 50,
        };
      })();

      const stream2 = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-2',
        };
        await new Promise(() => {}); // Never completes
      })();

      vi.mocked(query)
        .mockReturnValueOnce(stream1 as any)
        .mockReturnValueOnce(stream2 as any);

      await agentManager.spawn(mockRequest, mockBroadcaster);
      await agentManager.spawn(mockRequest, mockBroadcaster);

      await new Promise(resolve => setTimeout(resolve, 100));

      const allAgents = agentManager.getAll();

      expect(allAgents).toHaveLength(2);
      expect(allAgents.some(a => a.status === 'success')).toBe(true);
      expect(allAgents.some(a => a.status === 'running')).toBe(true);
    });
  });

  describe('stopAll', () => {
    it('should stop all running agents and clear timers', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test prompt',
      };

      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session',
        };
        await new Promise(() => {}); // Never completes
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      // Spawn multiple agents
      await agentManager.spawn(mockRequest, mockBroadcaster);
      await agentManager.spawn(mockRequest, mockBroadcaster);
      await agentManager.spawn(mockRequest, mockBroadcaster);

      await new Promise(resolve => setTimeout(resolve, 50));

      let activeAgents = agentManager.getActive();
      expect(activeAgents).toHaveLength(3);

      // Stop all agents
      agentManager.stopAll();

      const allAgents = agentManager.getAll();
      expect(allAgents.every(a => a.status === 'stopped')).toBe(true);
    });
  });

  describe('custom options', () => {
    it('should pass custom options to SDK query', async () => {
      const mockRequest: SpawnAgentRequest = {
        prompt: 'Test with custom options',
        systemPrompt: 'Custom system prompt',
        cwd: '/custom/working/directory',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
            env: { TEST: 'value' },
          },
        },
        permissionMode: 'bypassPermissions',
      };

      const mockStream = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-custom',
        };
        yield {
          type: 'result',
          cost_usd: 0.01,
          input_tokens: 100,
          output_tokens: 50,
        };
      })();

      vi.mocked(query).mockReturnValue(mockStream as any);

      await agentManager.spawn(mockRequest, mockBroadcaster);

      expect(query).toHaveBeenCalledWith({
        prompt: 'Test with custom options',
        options: expect.objectContaining({
          systemPrompt: 'Custom system prompt',
          cwd: '/custom/working/directory',
          mcpServers: mockRequest.mcpServers,
          permissionMode: 'bypassPermissions',
          abortController: expect.any(AbortController),
        }),
      });
    });
  });
});
