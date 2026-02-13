#!/usr/bin/env node

/**
 * Codegen script to generate backend/swarm-client.mjs from the template in swarmWorkletSource.ts
 *
 * This script:
 * 1. Reads the template string from swarmWorkletSource.ts
 * 2. Inlines protocol constants (MAX_PROMPT_SIZE, ErrorCode values)
 * 3. Outputs a standalone .mjs file ready for bare-pack bundling
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Template source location
const TEMPLATE_PATH = join(__dirname, '../src/worklet/swarmWorkletSource.ts');
const OUTPUT_PATH = join(__dirname, 'swarm-client.mjs');

// Protocol constants (from packages/protocol)
const MAX_PROMPT_SIZE = 8192;

const ErrorCode = {
  INVALID_SERVER_ID: "INVALID_SERVER_ID",
  CONNECT_FAILED: "CONNECT_FAILED",
  HOST_OFFLINE: "HOST_OFFLINE",
  HOST_DISCONNECTED: "HOST_DISCONNECTED",
  USER_DISCONNECTED: "USER_DISCONNECTED",
  BAD_MESSAGE: "BAD_MESSAGE",
  TIMEOUT_NO_RESPONSE: "TIMEOUT_NO_RESPONSE",
  MODEL_BUSY: "MODEL_BUSY",
};

function extractWorkletTemplate() {
  const source = readFileSync(TEMPLATE_PATH, 'utf8');

  // Extract the template string (starts with backtick on line 3, ends with backtick+semicolon on line 962)
  const match = source.match(/export const SWARM_WORKLET_SOURCE = `([\s\S]*?)`[;\s]*$/m);

  if (!match) {
    throw new Error('Could not extract worklet template from swarmWorkletSource.ts');
  }

  return match[1];
}

function inlineConstants(template) {
  let result = template;

  // Inline MAX_PROMPT_SIZE
  result = result.replace(/\$\{MAX_PROMPT_SIZE\}/g, String(MAX_PROMPT_SIZE));

  // Inline ErrorCode values (WITHOUT adding quotes - they're already in string literals)
  for (const [key, value] of Object.entries(ErrorCode)) {
    const pattern = new RegExp(`\\$\\{ErrorCode\\.${key}\\}`, 'g');
    result = result.replace(pattern, value);
  }

  return result;
}

function generateWorklet() {
  console.log('Generating worklet source...');
  console.log(`  Reading template from: ${TEMPLATE_PATH}`);

  const template = extractWorkletTemplate();
  console.log(`  Template extracted (${template.length} characters)`);

  const workletSource = inlineConstants(template);
  console.log(`  Constants inlined`);

  // Verify no unresolved templates remain
  const unresolvedTemplates = workletSource.match(/\$\{[^}]+\}/g);
  if (unresolvedTemplates) {
    console.error('ERROR: Unresolved template variables found:');
    unresolvedTemplates.forEach(t => console.error(`  - ${t}`));
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, workletSource, 'utf8');
  console.log(`  ✓ Generated: ${OUTPUT_PATH}`);
  console.log(`  Output size: ${workletSource.length} characters`);
}

try {
  generateWorklet();
} catch (error) {
  console.error('Failed to generate worklet:', error.message);
  process.exit(1);
}
