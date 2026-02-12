import * as vscode from 'vscode';

// ─── Tree Item Types ────────────────────────────────────────────

export type SynapseTreeItem = SessionItem | AgentItem | ToolItem;

class SessionItem extends vscode.TreeItem {
  readonly kind = 'session' as const;

  constructor(
    public readonly sessionId: string,
    label: string,
    public readonly agents: AgentItem[],
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'session';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    this.description = `${agents.length} agent${agents.length !== 1 ? 's' : ''}`;
  }
}

class AgentItem extends vscode.TreeItem {
  readonly kind = 'agent' as const;

  constructor(
    public readonly agentId: string,
    agentLabel: string,
    public readonly status: string,
    public readonly tools: ToolItem[],
  ) {
    super(
      agentLabel,
      tools.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'agent';
    this.iconPath = new vscode.ThemeIcon(
      status === 'running' ? 'pulse'
        : status === 'error' ? 'circle-slash'
          : 'check',
    );
    this.description = status;
  }
}

class ToolItem extends vscode.TreeItem {
  readonly kind = 'tool' as const;

  constructor(
    public readonly toolName: string,
    public readonly callCount: number,
  ) {
    super(toolName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'tool';
    this.iconPath = new vscode.ThemeIcon('wrench');
    this.description = `${callCount} call${callCount !== 1 ? 's' : ''}`;
  }
}

// ─── Data shape from WS events ─────────────────────────────────

export interface AgentSnapshot {
  agentId: string;
  agentType: string;
  sessionId: string;
  parentAgentId?: string;
  status: string;
  toolCalls: { toolName: string; toolUseId: string; status: string }[];
}

// ─── Tree Data Provider ─────────────────────────────────────────

export class SynapseTreeProvider implements vscode.TreeDataProvider<SynapseTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SynapseTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: Map<string, SessionItem> = new Map();

  // Accumulated state built from events
  private agentMap: Map<string, {
    agentId: string;
    agentType: string;
    sessionId: string;
    status: string;
    toolCounts: Map<string, number>;
  }> = new Map();

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Process an incoming WS event and rebuild tree state.
   * Accepts any object shaped like an AgentEvent from the server.
   */
  handleEvent(event: Record<string, unknown>): void {
    const type = event.type as string;
    const sessionId = event.sessionId as string;
    const agentId = event.agentId as string | undefined;
    const agentType = event.agentType as string | undefined;
    const status = event.status as string | undefined;
    const toolName = event.toolName as string | undefined;

    if (!sessionId) return;

    // Track agents
    if (agentId) {
      let agent = this.agentMap.get(agentId);
      if (!agent) {
        agent = {
          agentId,
          agentType: agentType || 'Agent',
          sessionId,
          status: 'running',
          toolCounts: new Map(),
        };
        this.agentMap.set(agentId, agent);
      }

      // Update status from relevant events
      if (type === 'agent_start') {
        agent.status = 'running';
        agent.agentType = agentType || agent.agentType;
      } else if (type === 'agent_stop' || type === 'result') {
        agent.status = status || 'success';
      } else if (type === 'stop' || type === 'session_end') {
        agent.status = status || 'stopped';
      }

      // Track tool usage
      if ((type === 'tool_start' || type === 'tool_end' || type === 'tool_error') && toolName) {
        const current = agent.toolCounts.get(toolName) || 0;
        // Only count on tool_start to avoid double counting
        if (type === 'tool_start') {
          agent.toolCounts.set(toolName, current + 1);
        }
      }
    }

    // Mark all agents in session as stopped on session_end
    if (type === 'session_end') {
      for (const agent of this.agentMap.values()) {
        if (agent.sessionId === sessionId && agent.status === 'running') {
          agent.status = 'stopped';
        }
      }
    }

    this.rebuildTree();
    this.refresh();
  }

  /**
   * Bulk-load from an array of events (e.g., initial fetch from /api/events).
   */
  loadEvents(events: Record<string, unknown>[]): void {
    for (const event of events) {
      // Process without refreshing each time
      this.handleEventSilent(event);
    }
    this.rebuildTree();
    this.refresh();
  }

  private handleEventSilent(event: Record<string, unknown>): void {
    const type = event.type as string;
    const sessionId = event.sessionId as string;
    const agentId = event.agentId as string | undefined;
    const agentType = event.agentType as string | undefined;
    const status = event.status as string | undefined;
    const toolName = event.toolName as string | undefined;

    if (!sessionId) return;

    if (agentId) {
      let agent = this.agentMap.get(agentId);
      if (!agent) {
        agent = {
          agentId,
          agentType: agentType || 'Agent',
          sessionId,
          status: 'running',
          toolCounts: new Map(),
        };
        this.agentMap.set(agentId, agent);
      }

      if (type === 'agent_start') {
        agent.status = 'running';
        agent.agentType = agentType || agent.agentType;
      } else if (type === 'agent_stop' || type === 'result') {
        agent.status = status || 'success';
      } else if (type === 'stop' || type === 'session_end') {
        agent.status = status || 'stopped';
      }

      if (type === 'tool_start' && toolName) {
        const current = agent.toolCounts.get(toolName) || 0;
        agent.toolCounts.set(toolName, current + 1);
      }
    }

    if (type === 'session_end') {
      for (const agent of this.agentMap.values()) {
        if (agent.sessionId === sessionId && agent.status === 'running') {
          agent.status = 'stopped';
        }
      }
    }
  }

  private rebuildTree(): void {
    // Group agents by session
    const sessionAgents = new Map<string, typeof this.agentMap extends Map<string, infer V> ? V[] : never>();

    for (const agent of this.agentMap.values()) {
      let agents = sessionAgents.get(agent.sessionId);
      if (!agents) {
        agents = [];
        sessionAgents.set(agent.sessionId, agents);
      }
      agents.push(agent);
    }

    this.sessions.clear();

    for (const [sessionId, agents] of sessionAgents) {
      const agentItems = agents.map(a => {
        const toolItems = Array.from(a.toolCounts.entries())
          .sort((x, y) => y[1] - x[1])
          .map(([name, count]) => new ToolItem(name, count));
        return new AgentItem(a.agentId, a.agentType, a.status, toolItems);
      });

      const shortId = sessionId.length > 12 ? sessionId.slice(0, 12) + '...' : sessionId;
      this.sessions.set(sessionId, new SessionItem(sessionId, `Session ${shortId}`, agentItems));
    }
  }

  /** Returns current counts for status bar. */
  getMetrics(): { agentCount: number; toolCallCount: number } {
    let agentCount = 0;
    let toolCallCount = 0;
    for (const agent of this.agentMap.values()) {
      agentCount++;
      for (const count of agent.toolCounts.values()) {
        toolCallCount += count;
      }
    }
    return { agentCount, toolCallCount };
  }

  // ─── TreeDataProvider interface ───────────────────────────────

  getTreeItem(element: SynapseTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SynapseTreeItem): SynapseTreeItem[] {
    if (!element) {
      // Root level: sessions
      return Array.from(this.sessions.values());
    }

    if (element instanceof SessionItem) {
      return element.agents;
    }

    if (element instanceof AgentItem) {
      return element.tools;
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
