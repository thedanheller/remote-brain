#!/usr/bin/env node

/**
 * Extracts the bundle content from the .mjs file and creates a TypeScript wrapper
 * that Metro can import at runtime.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT_ROOT = join(__dirname, '..');

const BUNDLE_MJS_PATH = join(CLIENT_ROOT, 'app/swarm-client.bundle.mjs');
const OUTPUT_TS_PATH = join(CLIENT_ROOT, 'src/worklet/swarmWorkletBundle.generated.ts');

function extractBundleContent() {
  console.log('Extracting bundle content...');
  console.log(`  Reading: ${BUNDLE_MJS_PATH}`);

  const mjsContent = readFileSync(BUNDLE_MJS_PATH, 'utf8');

  // The .mjs file is: export default "bundle_content_here"
  // Extract everything between the opening quote and closing quote
  if (!mjsContent.startsWith('export default "')) {
    throw new Error('Unexpected bundle format - should start with: export default "');
  }

  if (!mjsContent.endsWith('"') && !mjsContent.endsWith('"\n')) {
    throw new Error('Unexpected bundle format - should end with: "');
  }

  // Remove 'export default "' from start and '"' from end
  const bundleContent = mjsContent
    .slice('export default "'.length)
    .replace(/"[\n]*$/, '');

  console.log(`  Extracted bundle: ${bundleContent.length} characters`);

  // Create TypeScript file with the bundle as a const
  const tsContent = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT
 *
 * Generated from: app/swarm-client.bundle.mjs
 * To regenerate: npm run bundle:worklet
 */

export const SWARM_WORKLET_BUNDLE = "${bundleContent}";
`;

  writeFileSync(OUTPUT_TS_PATH, tsContent, 'utf8');
  console.log(`  ✓ Created: ${OUTPUT_TS_PATH}`);
}

try {
  extractBundleContent();
} catch (error) {
  console.error('Failed to extract bundle:', error.message);
  process.exit(1);
}
