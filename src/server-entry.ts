#!/usr/bin/env bun

import { runGodotServer } from './index.js';

await runGodotServer().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error('Failed to run server:', errorMessage);
  process.exit(1);
});
