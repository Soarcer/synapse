import { query } from '@anthropic-ai/claude-agent-sdk';
import { nanoid } from 'nanoid';
import type { Broadcaster } from './broadcaster.js';
import { insertEvent } from '../db.js';
import type {
  AgentEvent,
  SpawnAgentRequest,
  ActiveAgentInfo,
} from '../../src/types/agent.js';

const MAX_CONCURRENT_AGENTS = 10;
const AGENT_TIMEOUT_MS = 300_000; // 5 minutes

interface RunningAgent {
  agentId: string;
  sessionId: string;
  agentType: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  startTime: number;
  abortController: AbortController;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

export class AgentManager {
  private agents = new Map<string, RunningAgent>();

  async spawn(
    request: SpawnAgentRequest,
    broadcaster: Broadcaster,
  ): Promise<string> {
    const runningCount = Array.from(this.agents.values()).filter((a) => a.status === 'running').length;
    if (runningCount >= MAX_CONCURRENT_AGENTS) {
      throw new Error('Max concurrent agents reached');
    }

    const agentId = `agent-${nanoid(12)}`;
    const sessionId = request.sessionId || `sdk-${nanoid(8)}`;
    const startTime = Date.now();
    const abortController = new AbortController();

    const agent: RunningAgent = {
      agentId,
      sessionId,
      agentType: 'custom',
      status: 'running',
      startTime,
      abortController,
    };
    this.agents.set(agentId, agent);

    agent.timeoutTimer = setTimeout(() => this.stop(agentId), AGENT_TIMEOUT_MS);

    // Broadcast agent_start
    const startEvent: AgentEvent = {
      id: nanoid(),
      type: 'agent_start',
      sessionId,
      agentId,
      agentType: 'custom',
      status: 'running',
      timestamp: startTime,
    };
    this.persistAndBroadcast(startEvent, 'SpawnAgent', request, broadcaster);

    // Run agent in background (don't await)
    this.runAgent(agentId, request, broadcaster).catch((err) => {
      console.error(`[AgentManager] Agent ${agentId} error:`, err);
    });

    return agentId;
  }

  private async runAgent(
    agentId: string,
    request: SpawnAgentRequest,
    broadcaster: Broadcaster,
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    try {
      const options: Record<string, unknown> = {
        allowedTools: request.tools,
        permissionMode: request.permissionMode || 'acceptEdits',
      };
      if (request.systemPrompt) {
        options.systemPrompt = request.systemPrompt;
      }
      if (request.mcpServers) {
        options.mcpServers = request.mcpServers;
      }
      if (request.cwd) {
        options.cwd = request.cwd;
      }

      const stream = query({
        prompt: request.prompt,
        options: {
          ...options,
          model: request.model,
          abortController: agent.abortController,
        } as any,
      });

      for await (const message of stream) {
        if (agent.abortController.signal.aborted) break;

        // SystemMessage — capture session ID
        if (message.type === 'system' && (message as any).subtype === 'init') {
          const sdkSessionId = (message as any).session_id;
          if (sdkSessionId) agent.sessionId = sdkSessionId;
        }

        // StreamEvent — real-time streaming
        if (message.type === 'stream_event') {
          const rawEvent = (message as any).event;
          this.handleStreamEvent(agentId, agent, rawEvent, broadcaster);
        }

        // ResultMessage — final result with usage
        if (message.type === 'result') {
          const result = message as any;
          const endTime = Date.now();
          const tokenUsage = result.cost_usd != null
            ? { input: result.input_tokens ?? 0, output: result.output_tokens ?? 0 }
            : undefined;

          agent.status = 'success';
          if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
          const stopEvent: AgentEvent = {
            id: nanoid(),
            type: 'agent_stop',
            sessionId: agent.sessionId,
            agentId,
            agentType: agent.agentType,
            status: 'success',
            tokenUsage,
            duration: endTime - agent.startTime,
            timestamp: endTime,
          };
          this.persistAndBroadcast(stopEvent, 'AgentResult', result, broadcaster);
          this.scheduleCleanup(agentId);
        }
      }
    } catch (err: unknown) {
      if (agent.abortController.signal.aborted) return;

      const message = err instanceof Error ? err.message : String(err);
      agent.status = 'error';
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      const errorEvent: AgentEvent = {
        id: nanoid(),
        type: 'agent_stop',
        sessionId: agent.sessionId,
        agentId,
        agentType: agent.agentType,
        status: 'error',
        error: message,
        duration: Date.now() - agent.startTime,
        timestamp: Date.now(),
      };
      this.persistAndBroadcast(errorEvent, 'AgentError', { error: message }, broadcaster);
      this.scheduleCleanup(agentId);
    }
  }

  private handleStreamEvent(
    agentId: string,
    agent: RunningAgent,
    rawEvent: any,
    broadcaster: Broadcaster,
  ): void {
    const eventType = rawEvent?.type;

    // content_block_start with tool_use → tool_start
    if (eventType === 'content_block_start' && rawEvent.content_block?.type === 'tool_use') {
      const block = rawEvent.content_block;
      const event: AgentEvent = {
        id: nanoid(),
        type: 'tool_start',
        sessionId: agent.sessionId,
        agentId,
        toolName: block.name,
        toolUseId: block.id,
        status: 'running',
        timestamp: Date.now(),
      };
      this.persistAndBroadcast(event, 'StreamToolStart', rawEvent, broadcaster);
    }

    // content_block_delta with text_delta → text_delta
    if (eventType === 'content_block_delta' && rawEvent.delta?.type === 'text_delta') {
      const text = rawEvent.delta.text;
      if (text) {
        broadcaster.broadcastText(agentId, text, true);
      }
    }
  }

  private persistAndBroadcast(
    event: AgentEvent,
    hookEventName: string,
    raw: any,
    broadcaster: Broadcaster,
  ): void {
    event.eventSource = 'sdk';
    try {
      insertEvent({
        event_id: event.id,
        session_id: event.sessionId,
        hook_event_name: hookEventName,
        event_type: event.type,
        agent_id: event.agentId,
        agent_type: event.agentType,
        parent_agent_id: event.parentAgentId,
        tool_name: event.toolName,
        tool_use_id: event.toolUseId,
        tool_input: event.toolInput ? JSON.stringify(event.toolInput) : null,
        tool_response: event.toolResponse ? JSON.stringify(event.toolResponse) : null,
        status: event.status,
        error: event.error,
        token_input: event.tokenUsage?.input,
        token_output: event.tokenUsage?.output,
        duration_ms: event.duration,
        raw_payload: JSON.stringify(raw),
        created_at: event.timestamp,
      });
    } catch (err) {
      console.error('[AgentManager] Failed to persist event:', err);
    }
    broadcaster.broadcast(event);
  }

  stop(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    agent.abortController.abort();
    agent.status = 'stopped';
    return true;
  }

  async sendMessage(
    agentId: string,
    message: string,
    broadcaster: Broadcaster,
  ): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'success') return false;

    // Clear cleanup timer if agent is being resumed
    if (agent.cleanupTimer) {
      clearTimeout(agent.cleanupTimer);
      agent.cleanupTimer = undefined;
    }

    // Resume session with new prompt
    agent.status = 'running';
    agent.abortController = new AbortController();

    const resumeEvent: AgentEvent = {
      id: nanoid(),
      type: 'agent_start',
      sessionId: agent.sessionId,
      agentId,
      agentType: agent.agentType,
      status: 'running',
      text: message,
      timestamp: Date.now(),
    };
    this.persistAndBroadcast(resumeEvent, 'AgentResume', { message }, broadcaster);

    // Run in background
    this.runAgent(agentId, { prompt: message } as SpawnAgentRequest, broadcaster).catch(
      (err) => console.error(`[AgentManager] Resume error for ${agentId}:`, err),
    );

    return true;
  }

  getActive(): ActiveAgentInfo[] {
    return Array.from(this.agents.values())
      .filter((a) => a.status === 'running')
      .map((a) => ({
        agentId: a.agentId,
        agentType: a.agentType,
        sessionId: a.sessionId,
        status: a.status,
        startTime: a.startTime,
      }));
  }

  getAll(): ActiveAgentInfo[] {
    return Array.from(this.agents.values()).map((a) => ({
      agentId: a.agentId,
      agentType: a.agentType,
      sessionId: a.sessionId,
      status: a.status,
      startTime: a.startTime,
    }));
  }

  /** Stop all running agents and clear cleanup/timeout timers */
  stopAll(): void {
    for (const agent of this.agents.values()) {
      if (agent.cleanupTimer) clearTimeout(agent.cleanupTimer);
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      if (agent.status === 'running') {
        agent.abortController.abort();
        agent.status = 'stopped';
      }
    }
  }

  /** Schedule removal of a completed agent from memory after a delay */
  private scheduleCleanup(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.timeoutTimer) {
      clearTimeout(agent.timeoutTimer);
      agent.timeoutTimer = undefined;
    }
    agent.cleanupTimer = setTimeout(() => {
      this.agents.delete(agentId);
    }, 5 * 60 * 1000); // 5 minutes
  }
}
