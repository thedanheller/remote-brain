#!/usr/bin/env node

/**
 * Bundle orchestrator for swarm worklet
 *
 * Two-step process:
 * 1. Run codegen: node backend/generateWorklet.mjs
 * 2. Run bare-pack: npx bare-pack ... backend/swarm-client.mjs → app/swarm-client.bundle.mjs
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT_ROOT = join(__dirname, '..');

function run(command, description) {
  console.log(`\n${description}...`);
  console.log(`  $ ${command}`);

  try {
    execSync(command, {
      cwd: CLIENT_ROOT,
      stdio: 'inherit',
      encoding: 'utf8',
    });
  } catch (error) {
    console.error(`\nERROR: ${description} failed`);
    process.exit(1);
  }
}

function verifyBundle() {
  const bundlePath = join(CLIENT_ROOT, 'app/swarm-client.bundle.mjs');

  if (!existsSync(bundlePath)) {
    console.error('\nERROR: Bundle file was not created');
    process.exit(1);
  }

  const stats = statSync(bundlePath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`\n✓ Bundle created successfully`);
  console.log(`  Path: ${bundlePath}`);
  console.log(`  Size: ${sizeMB} MB`);

  if (stats.size < 100000) {
    console.warn('\n⚠️  WARNING: Bundle size is suspiciously small (<100KB)');
    console.warn('   Expected size is >1MB when hyperswarm is bundled');
  }
}

console.log('=== Bundling Swarm Worklet ===\n');
console.log('This will:');
console.log('  1. Generate backend/swarm-client.mjs (with inlined constants)');
console.log('  2. Bundle with bare-pack → app/swarm-client.bundle.mjs');
console.log('  3. Extract bundle to TypeScript wrapper');

// Step 1: Generate worklet source with inlined constants
run(
  'node backend/generateWorklet.mjs',
  'Step 1: Generating worklet source'
);

// Step 2: Bundle with bare-pack
// Note: Using --target darwin-arm64 and --linked per plan
run(
  'npx bare-pack --target darwin-arm64 --linked --out app/swarm-client.bundle.mjs backend/swarm-client.mjs',
  'Step 2: Bundling with bare-pack'
);

// Verify bundle was created successfully
verifyBundle();

// Step 3: Extract bundle content to TypeScript file
run(
  'node scripts/extractBundle.mjs',
  'Step 3: Extracting bundle to TypeScript'
);

console.log('\n=== Bundling Complete ===\n');
