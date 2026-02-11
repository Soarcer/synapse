import { SynapseConfigSchema } from './config.js';
import type { SynapseConfig, PluginDeps, OpenClawTool } from './types.js';
import { JsonlBridge } from './layers/jsonlBridge.js';
import { createAgentTools } from './layers/agentTools.js';
import { ProviderWrapper } from './layers/providerWrapper.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  id: 'synapse-monitor',
  slot: 'tool' as const,
  metadata: {
    name: 'Synapse — AI Monitor',
    description: 'Real-time AI agent monitoring dashboard for OpenClaw',
  },
  schema: SynapseConfigSchema,

  init: async (config: SynapseConfig, deps: PluginDeps) => {
    const { logger, configDir } = deps;
    const port = config.port || 4000;

    logger.info(`[Synapse] Initializing on port ${port}`);

    // ── 1. Start Synapse server as child process ──
    const serverDir = path.resolve(__dirname, '..');
    const serverEntry = path.join(serverDir, 'server', 'index.ts');

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PORT: String(port),
      SYNAPSE_MODE: 'openclaw',
    };

    if (config.dbPath) {
      env.SYNAPSE_DB_PATH = config.dbPath;
    }

    const serverProcess = spawn('npx', ['tsx', serverEntry], {
      cwd: serverDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      logger.info(`[Synapse Server] ${data.toString().trim()}`);
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      logger.warn(`[Synapse Server] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      logger.error(`[Synapse] Server process error: ${err.message}`);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        logger.error(`[Synapse] Server exited with code ${code}`);
      }
    });

    // Wait for server to be ready
    await waitForServer(port, 10_000);
    logger.info(`[Synapse] Server ready at http://localhost:${port}`);

    // ── 2. Layer 1: JSONL Transcript Watcher ──
    let jsonlBridge: JsonlBridge | undefined;
    if (config.layers.transcriptWatcher) {
      jsonlBridge = new JsonlBridge(port, logger);
      const watchPaths = config.watchPaths.length > 0
        ? config.watchPaths
        : [path.join(configDir, 'agents')];

      for (const watchPath of watchPaths) {
        jsonlBridge.watchAgentsDir(watchPath);
      }
      logger.info(`[Synapse] Layer 1: Transcript watcher active (${watchPaths.length} path(s))`);
    }

    // ── 3. Layer 2: Agent Tools ──
    let tools: OpenClawTool[] = [];
    if (config.layers.agentTools) {
      tools = createAgentTools(port);
      logger.info(`[Synapse] Layer 2: ${tools.length} agent tools registered`);
    }

    // ── 4. Layer 3: Provider Wrapper ──
    let providerWrapper: ProviderWrapper | undefined;
    if (config.layers.providerWrapper && config.wrappedProviders.length > 0) {
      providerWrapper = new ProviderWrapper(port, config.wrappedProviders, logger);
      logger.info(`[Synapse] Layer 3: Provider wrapper for ${config.wrappedProviders.join(', ')}`);
    }

    // ── Cleanup on shutdown ──
    const cleanup = () => {
      jsonlBridge?.stop();
      providerWrapper?.stop();
      if (serverProcess.pid && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    return {
      tools,
      dispose: cleanup,
    };
  },
};

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Synapse server did not start within ${timeoutMs}ms`);
}
