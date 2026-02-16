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
};

export default en;
