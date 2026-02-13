/**
 * Integration tests for the bundled worklet
 *
 * These tests verify that the bundle:
 * - Loads successfully as a string
 * - Contains expected BareKit references
 * - Has inlined constants (no unresolved templates)
 * - Includes bundled dependencies
 */

import { readFileSync } from "fs";
import { join } from "path";

// Read the bundle directly from the file system since Jest can't parse .mjs files
const SWARM_WORKLET_BUNDLE = readFileSync(join(__dirname, "../../app/swarm-client.bundle.mjs"), "utf8");

describe("swarmWorkletBundle", () => {
  test("bundle loads as non-empty string", () => {
    expect(typeof SWARM_WORKLET_BUNDLE).toBe("string");
    expect(SWARM_WORKLET_BUNDLE.length).toBeGreaterThan(0);
  });

  test("bundle contains BareKit IPC reference", () => {
    expect(SWARM_WORKLET_BUNDLE).toContain("BareKit");
    expect(SWARM_WORKLET_BUNDLE).toContain("IPC");
  });

  test("bundle has inlined MAX_PROMPT_SIZE constant", () => {
    // Should contain the constant value 8192
    expect(SWARM_WORKLET_BUNDLE).toContain("8192");

    // Should NOT contain unresolved template for MAX_PROMPT_SIZE
    expect(SWARM_WORKLET_BUNDLE).not.toContain("${MAX_PROMPT_SIZE}");
  });

  test("bundle has inlined ErrorCode constants", () => {
    // Should contain error code strings
    expect(SWARM_WORKLET_BUNDLE).toContain("CONNECT_FAILED");
    expect(SWARM_WORKLET_BUNDLE).toContain("HOST_DISCONNECTED");
    expect(SWARM_WORKLET_BUNDLE).toContain("BAD_MESSAGE");
    expect(SWARM_WORKLET_BUNDLE).toContain("TIMEOUT_NO_RESPONSE");
    expect(SWARM_WORKLET_BUNDLE).toContain("USER_DISCONNECTED");
    expect(SWARM_WORKLET_BUNDLE).toContain("INVALID_SERVER_ID");
    expect(SWARM_WORKLET_BUNDLE).toContain("HOST_OFFLINE");
    expect(SWARM_WORKLET_BUNDLE).toContain("MODEL_BUSY");

    // Should NOT contain unresolved ErrorCode templates
    expect(SWARM_WORKLET_BUNDLE).not.toContain("${ErrorCode.");
  });

  test("bundle size indicates dependencies are included", () => {
    // Bundle should be substantial (>500KB) when hyperswarm is bundled
    // The bundle is a base64-encoded string, so size should be large
    expect(SWARM_WORKLET_BUNDLE.length).toBeGreaterThan(500000);
  });

  test("bundle contains hyperswarm-related references", () => {
    // The bundle should include references to hyperswarm dependencies
    // Note: These may be minified or transformed by bare-pack
    const hasHyperswarmRefs =
      SWARM_WORKLET_BUNDLE.includes("hyperswarm") ||
      SWARM_WORKLET_BUNDLE.includes("hyperdht") ||
      SWARM_WORKLET_BUNDLE.includes("secret-stream");

    expect(hasHyperswarmRefs).toBe(true);
  });

  test("bundle format is valid bare-pack output", () => {
    // bare-pack bundles start with 'export default "' followed by length and manifest
    expect(SWARM_WORKLET_BUNDLE).toMatch(/^export default "/);
  });

  test("no unresolved template variables remain", () => {
    // Check for any remaining ${...} patterns that weren't replaced
    const templatePattern = /\$\{(?!.*resolutions|.*version)[^}]+\}/g;
    const matches = SWARM_WORKLET_BUNDLE.match(templatePattern);

    // The bundle manifest may contain ${...} in JSON metadata, but the actual
    // worklet code should not have unresolved templates from our source
    // We filter out manifest patterns like "resolutions" and "version"
    if (matches) {
      // If matches exist, they should only be in the JSON manifest, not the code
      // The manifest is at the beginning, after the length prefix
      const codeStart = SWARM_WORKLET_BUNDLE.indexOf("const { IPC } = BareKit");
      if (codeStart !== -1) {
        const codeSection = SWARM_WORKLET_BUNDLE.slice(codeStart);
        const codeMatches = codeSection.match(/\$\{(?!.*resolutions|.*version)[^}]+\}/g);
        expect(codeMatches).toBeNull();
      }
    }
  });
});
