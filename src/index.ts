#!/usr/bin/env node
import { GodotMcpOmniServer } from './server.js';

const server = new GodotMcpOmniServer();
server.run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[SERVER] Failed to start:', message);
  process.exit(1);
});
