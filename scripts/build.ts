#!/usr/bin/env bun
/**
 * Bundles src/ into dist/index.js: one dependency-free ESM file targeting Node >= 18.
 *
 * Bun runs it too, so a single artifact covers every user. It is committed to the repo
 * because `npx github:omznc/olx-mcp` runs it straight from a clone with no build step.
 */
import { chmod, mkdir, rm } from "node:fs/promises";
import pkg from "../package.json" with { type: "json" };

const ENTRY = new URL("../src/index.ts", import.meta.url).pathname;
const OUT = new URL("../dist/", import.meta.url).pathname;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const result = await Bun.build({
	entrypoints: [ENTRY],
	outdir: OUT,
	target: "node",
	format: "esm",
	minify: false, // keep stack traces legible; size is not a concern for a local server
	// Version is baked in so the running server can report it without reading package.json.
	define: { "process.env.OLX_MCP_VERSION": JSON.stringify(pkg.version) },
	// No banner: Bun preserves the `#!/usr/bin/env node` shebang already in src/index.ts,
	// and a second one would be a syntax error.
});

if (!result.success) {
	console.error("Bundle failed:");
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

await chmod(`${OUT}index.js`, 0o755);
console.log(`built dist/index.js (node >= 18, v${pkg.version})`);
