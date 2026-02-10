#!/usr/bin/env tsx

/**
 * Script to spawn 2 agents with simple tasks
 */

const API_BASE = 'http://localhost:4000/api';

interface SpawnResponse {
  ok: boolean;
  agentId: string;
}

async function spawnAgent(name: string, prompt: string, agentType: string = 'general-purpose'): Promise<string> {
  const response = await fetch(`${API_BASE}/agents/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, prompt, agentType })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to spawn agent: ${response.statusText} - ${error}`);
  }

  const result = await response.json() as SpawnResponse;
  return result.agentId;
}

async function main() {
  console.log('🚀 Spawning 2 agents with simple tasks...\n');

  try {
    // Agent 1: List files task
    console.log('📝 Agent 1: Listing project files');
    const agent1Id = await spawnAgent(
      'File Explorer',
      'List all TypeScript files in the src directory and count how many there are. Just use glob to find them and give me a quick count.',
      'Explore'
    );
    console.log(`✅ Spawned Agent 1: File Explorer (${agent1Id})\n`);

    // Small delay to avoid race conditions
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Agent 2: Search task
    console.log('🔍 Agent 2: Searching for WebSocket code');
    const agent2Id = await spawnAgent(
      'Code Searcher',
      'Search for files that contain "WebSocket" or "ws" in the codebase and tell me which files handle WebSocket connections.',
      'Explore'
    );
    console.log(`✅ Spawned Agent 2: Code Searcher (${agent2Id})\n`);

    console.log('✨ Both agents spawned successfully!');
    console.log('📊 Check the Synapse UI to see them in action.');
    console.log(`\nAgent IDs:\n  - Agent 1: ${agent1Id}\n  - Agent 2: ${agent2Id}`);

  } catch (error) {
    console.error('❌ Error spawning agents:', error);
    process.exit(1);
  }
}

main();
