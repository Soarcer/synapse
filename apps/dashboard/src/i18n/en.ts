// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/** English locale — default translations for Synapse dashboard */
const en: Record<string, string> = {
  // App-level
  'app.loading': 'Loading...',
  'app.error.generic': 'Something went wrong',

  // Graph
  'graph.empty': 'Waiting for agent events...',
  'graph.search.placeholder': 'Search nodes...',
  'graph.search.label': 'Search graph nodes',

  // Toast messages
  'toast.eventLimit': 'Event limit reached — oldest events trimmed',
  'toast.spawnFailed': 'Failed to spawn agent',
  'toast.clickToFocus': 'click to focus',

  // Dialogs
  'dialog.confirm.cancel': 'Cancel',
  'dialog.confirm.ok': 'OK',
  'dialog.confirm.delete': 'Delete',

  // Error boundary
  'error.title': 'Something went wrong',
  'error.retry': 'Try Again',
  'error.description': 'An unexpected error occurred in this component.',

  // Header / status
  'header.serverDown': 'Server disconnected',
  'header.reconnecting': 'Reconnecting...',

  // Panels
  'panel.toolLog.empty': 'No tool calls yet',
  'panel.spawn.title': 'Spawn Agent',
  'panel.spawn.prompt': 'Prompt',
  'panel.spawn.submit': 'Spawn',

  // ── Tour strings ── [tour]
  // Launcher
  'tour.launcher.title': 'Take a Tour',
  'tour.launcher.body': 'See how Synapse monitors your Claude agents in real-time',
  'tour.launcher.start': 'Start Tour',
  'tour.launcher.dismiss': 'Maybe later',
  'tour.skip': 'Skip tour',
  'tour.next': 'Next',
  'tour.prev': 'Back',
  'tour.finish': 'Finish',
  'tour.continue.title': 'Keep going?',
  'tour.continue.body': 'That covers the core dashboard! Want to continue to Analytics and Pixel Mode?',
  'tour.continue.yes': 'Continue',
  'tour.continue.no': 'Finish Here',

  // Chapter titles
  'tour.chapter.graph': 'The Graph',
  'tour.chapter.lens': 'Lens Panel',
  'tour.chapter.panels': 'Detail Panels',
  'tour.chapter.header': 'Header Controls',
  'tour.chapter.settings': 'Settings & Tools',
  'tour.chapter.analytics': 'Analytics',
  'tour.chapter.pixel': 'Pixel Mode',

  // Auto-play narrations
  'tour.auto.title': 'Auto-Play Demo',
  'tour.auto.exploreBtn': 'Start exploring →',
  'tour.auto.sessionStart': 'A Claude Code session just started — every session gets its own root node.',
  'tour.auto.prompt1': 'You typed a prompt — it becomes a node connected to the session.',
  'tour.auto.tools1': 'The agent reads, edits, and runs bash — tool calls appear as grouped pills.',
  'tour.auto.prompt2': 'Another prompt, another branch. The graph grows as the conversation continues.',
  'tour.auto.explore': 'Claude spawned an Explore subagent — a new purple node with its own tools.',
  'tour.auto.error': 'A tool failed — the red status dot tells you instantly.',
  'tour.auto.taskChild': 'The Task tool spawned a child agent — notice the purple edge with a token cost badge.',
  'tour.auto.compaction': 'Context was compacted — the scissors icon marks where Claude trimmed its memory.',
  'tour.auto.complete': "That's a complete session. Ready to explore?",

  // Chapter 1: Graph
  'tour.graph.sessionNode.title': 'Session Node',
  'tour.graph.sessionNode.body': 'The root of every session. Shows the session ID, git branch, cost estimate, a token sparkline, and agent/tool counts.',
  'tour.graph.promptNode.title': 'User Prompt',
  'tour.graph.promptNode.body': 'Each prompt you type becomes a node. It shows the text preview, token stats, and a compaction indicator if context was trimmed.',
  'tour.graph.agentNode.title': 'Agent Node',
  'tour.graph.agentNode.body': 'Subagents like Explore and Plan appear as purple nodes. They show status, streaming text, token counts, and a progress bar while running.',
  'tour.graph.toolGroupCollapsed.title': 'Tool Group (Collapsed)',
  'tour.graph.toolGroupCollapsed.body': 'Leaf tools are grouped into a compact chip showing count, total duration, and status dots.',
  'tour.graph.toolGroupExpanded.title': 'Tool Group (Expanded)',
  'tour.graph.toolGroupExpanded.body': 'Press F to expand — each tool becomes a clickable pill with name, duration, and status. Three view modes: Pill Grid, Timeline, Heatmap.',
  'tour.graph.structuralTool.title': 'Structural Tool',
  'tour.graph.structuralTool.body': 'Tools that spawn child agents (like Task) stay as individual nodes with their own connection handle.',
  'tour.graph.edges.title': 'Edges',
  'tour.graph.edges.body': 'Gray dashed = data flow. Purple solid = task → child agent. Blue animated = currently active.',
  'tour.graph.costBadge.title': 'Cost Badge',
  'tour.graph.costBadge.body': 'Purple pill on task edges showing the token transfer between parent and child agent.',
  'tour.graph.spawnAgent.title': 'Spawn Agent',
  'tour.graph.spawnAgent.body': 'Click this or press N to spawn a new agent via the Agent SDK. Choose model, tools, and permissions.',
  'tour.graph.search.title': 'Graph Search',
  'tour.graph.search.body': 'Press / to focus. Search by node name, tool, or session ID. Matches highlight in the graph.',

  // Chapter 2: Lens Panel
  'tour.lens.overview.title': 'Lens Panel',
  'tour.lens.overview.body': 'Seven analysis tabs on the left. Press 1–7 to switch. Drag the edge to resize.',
  'tour.lens.treeView.title': 'Tree View',
  'tour.lens.treeView.body': 'Hierarchical list of all nodes. Click to select, expand/collapse branches, shift+scroll to zoom.',
  'tour.lens.heatmap.title': 'Heatmap',
  'tour.lens.heatmap.body': 'Tool call frequency over time. Bright cells = more activity. Click a cell to focus that node.',
  'tour.lens.treemap.title': 'Treemap',
  'tour.lens.treemap.body': 'Token distribution as nested rectangles. Larger areas = more tokens consumed.',
  'tour.lens.sankey.title': 'Sankey Flow',
  'tour.lens.sankey.body': 'Flow diagram from sessions → prompts → agents → tools. Width = token volume.',
  'tour.lens.compaction.title': 'Compaction View',
  'tour.lens.compaction.body': 'Context growth chart with compaction markers. Red dashed lines show where Claude trimmed its memory.',
  'tour.lens.costWaterfall.title': 'Cost Waterfall',
  'tour.lens.costWaterfall.body': 'Turn-by-turn token cost with a cumulative line chart. Toggle zero-token turns on/off.',
  'tour.lens.alerts.title': 'Alerts',
  'tour.lens.alerts.body': 'Notification feed — permission requests, warnings, and system events from your sessions.',

  // Chapter 3: Detail Panels
  'tour.panels.selectNode.title': 'Select a Node',
  'tour.panels.selectNode.body': 'Click any node in the graph to select it. A detail panel opens on the right with stats and metadata.',
  'tour.panels.agentDetail.title': 'Agent Detail',
  'tour.panels.agentDetail.body': 'Token breakdown (input, output, cache), model info, tool badges, and timing stats for the selected agent.',
  'tour.panels.reasoning.title': 'Reasoning Section',
  'tour.panels.reasoning.body': 'AI-generated analysis of the agent\'s behavior. Switch between Developer and Vibe modes for different perspectives.',
  'tour.panels.timeline.title': 'Timeline Panel',
  'tour.panels.timeline.body': 'Bottom bar showing agent activity over time. Colored bars for each agent, markers for tool calls. Scroll to zoom.',
  'tour.panels.toolLog.title': 'Tool Log',
  'tour.panels.toolLog.body': 'Chronological history of tool calls. Filter by tool name or status. Click to jump to the node in the graph.',
  'tour.panels.keyboardNav.title': 'Keyboard Navigation',
  'tour.panels.keyboardNav.body': 'Arrow keys navigate between nodes. Enter selects. Tab cycles through detail sections. Press ? for all shortcuts.',

  // Chapter 4: Header Controls
  'tour.header.connectionStatus.title': 'Connection Status',
  'tour.header.connectionStatus.body': 'Green = connected to server. Yellow = reconnecting. Red = disconnected. Events stream in real-time via WebSocket.',
  'tour.header.sessionSelector.title': 'Session Selector',
  'tour.header.sessionSelector.body': 'Switch between active and past sessions. Each session is a separate Claude Code invocation.',
  'tour.header.timeFilter.title': 'Time Filter',
  'tour.header.timeFilter.body': 'Filter events by time range — last hour, today, this week, or all time. Helps focus on recent activity.',
  'tour.header.pauseResume.title': 'Pause / Resume',
  'tour.header.pauseResume.body': 'Press Space to pause live updates. New events queue silently. Press Space again to resume and catch up.',
  'tour.header.graphStats.title': 'Graph Stats',
  'tour.header.graphStats.body': 'At-a-glance metrics: total nodes, prompts/agents/tools breakdown, combined tokens, estimated cost, and wall-clock duration.',
  'tour.header.exportImport.title': 'Export & Import',
  'tour.header.exportImport.body': 'Save the current graph as a JSON snapshot (E key) or load a previous one (I key). Great for sharing or debugging.',
  'tour.header.shortcuts.title': 'Keyboard Shortcuts',
  'tour.header.shortcuts.body': 'Press ? to see all available shortcuts. Every major action has a single-key binding.',

  // Chapter 5: Settings & Tools
  'tour.settings.overview.title': 'View Settings',
  'tour.settings.overview.body': 'Click the gear icon to open display options. Toggle features on/off, change tool visualization modes.',
  'tour.settings.lockViewport.title': 'Lock Viewport',
  'tour.settings.lockViewport.body': 'Press V to lock the camera. New nodes won\'t auto-scroll the view. Useful when examining a specific area.',
  'tour.settings.expandTools.title': 'Expand Tools',
  'tour.settings.expandTools.body': 'Press F to toggle between collapsed tool groups (compact chip) and expanded view (individual pills).',
  'tour.settings.hookEvents.title': 'Hook Events',
  'tour.settings.hookEvents.body': 'Press H to show/hide non-graph events like Stop, PermissionRequest, and Notification in the timeline.',
  'tour.settings.autoClosePrompts.title': 'Auto-Close Prompts',
  'tour.settings.autoClosePrompts.body': 'Press C to auto-collapse previous prompt nodes when new ones arrive. Keeps the graph compact.',
  'tour.settings.toolViewModes.title': 'Tool View Modes',
  'tour.settings.toolViewModes.body': 'Three ways to visualize tool groups: Pill Grid (default), Timeline (duration bars), and Heatmap (status grid).',

  // Chapter 6: Analytics (optional)
  'tour.analytics.overview.title': 'Analytics Dashboard',
  'tour.analytics.overview.body': 'A separate view with session-level insights: cost trends, model usage, token breakdowns, coaching nudges, and session replay.',
  'tour.analytics.navigation.title': 'Opening Analytics',
  'tour.analytics.navigation.body': 'Click the Analytics link in the header (amber icon) to open the analytics dashboard in a new tab.',

  // Chapter 7: Pixel Mode (optional)
  'tour.pixel.overview.title': 'Pixel Mode',
  'tour.pixel.overview.body': 'A retro pixel-art office visualization where agents walk around as characters. A fun way to monitor long-running sessions.',
  'tour.pixel.howToActivate.title': 'Activating Pixel Mode',
  'tour.pixel.howToActivate.body': 'Press G to toggle arcade mode, or open it as a standalone view at ?view=pixel.',
};

export default en;
