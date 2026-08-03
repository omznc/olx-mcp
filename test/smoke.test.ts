/**
 * End-to-end checks against a real server process over stdio. Tests that call the live OLX
 * API are opt-in via OLX_LIVE_TESTS=1; everything else here is hermetic.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import pkg from "../package.json" with { type: "json" };

const SRC = new URL("../src/index.ts", import.meta.url).pathname;
const DIST = new URL("../dist/index.js", import.meta.url).pathname;

const liveTest = test.skipIf(!process.env.OLX_LIVE_TESTS);

/** Isolated config dir so tests never read or clobber a real saved token. */
let configDir: string;

beforeAll(async () => {
	configDir = await mkdtemp(join(tmpdir(), "olx-mcp-test-"));
});
afterAll(async () => {
	await rm(configDir, { recursive: true, force: true });
});

async function connect(runtime: "bun" | "node" = "bun") {
	const client = new Client({ name: "smoke", version: "1.0.0" });
	await client.connect(
		new StdioClientTransport({
			command: runtime,
			args: [runtime === "bun" ? SRC : DIST],
			env: { PATH: process.env.PATH ?? "", OLX_MCP_CONFIG_DIR: configDir },
		}),
	);
	return client;
}

/** Tools that must never be auto-approved: they delete data or spend the account balance. */
const DESTRUCTIVE = [
	"olx_delete_listing",
	"olx_delete_listing_image",
	"olx_sponsor_listing",
	"olx_logout",
];

/** A sample of tools that only read, and so are safe for a client to run unattended. */
const READ_ONLY = [
	"olx_search_listings",
	"olx_get_listing",
	"olx_categories",
	"olx_cities",
	"olx_sponsor_price",
	"olx_me",
];

describe("olx-mcp", () => {
	test("exposes every tool with a description and an object schema", async () => {
		const client = await connect();
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name);

		expect(names).toContain("olx_search_listings");
		expect(names).toContain("olx_create_listing");
		expect(names).toContain("olx_sponsor_price");
		expect(names).toContain("olx_logout");
		for (const t of tools) {
			expect(t.description?.length).toBeGreaterThan(20);
			expect(t.inputSchema.type).toBe("object");
		}
		await client.close();
	});

	test("annotates every tool, so clients can tell reads from writes", async () => {
		const client = await connect();
		const { tools } = await client.listTools();

		const missing = tools.filter((t) => t.annotations?.readOnlyHint === undefined);
		expect(missing.map((t) => t.name)).toEqual([]);
		await client.close();
	});

	test("marks the tools that destroy data or spend money", async () => {
		const client = await connect();
		const { tools } = await client.listTools();
		const byName = new Map(tools.map((t) => [t.name, t.annotations]));

		for (const name of DESTRUCTIVE) {
			expect(byName.get(name)?.readOnlyHint, name).toBe(false);
			expect(byName.get(name)?.destructiveHint, name).toBe(true);
		}
		// Logging out only deletes a local file, so it is not an open-world call.
		expect(byName.get("olx_logout")?.openWorldHint).toBe(false);
		await client.close();
	});

	test("marks read-only tools as read-only and idempotent", async () => {
		const client = await connect();
		const { tools } = await client.listTools();
		const byName = new Map(tools.map((t) => [t.name, t.annotations]));

		for (const name of READ_ONLY) {
			expect(byName.get(name)?.readOnlyHint, name).toBe(true);
			expect(byName.get(name)?.idempotentHint, name).toBe(true);
		}
		// Creating a listing is a write, and repeating it creates a second listing.
		expect(byName.get("olx_create_listing")?.readOnlyHint).toBe(false);
		expect(byName.get("olx_create_listing")?.idempotentHint).toBe(false);
		await client.close();
	});

	test("reports a readable error when not logged in", async () => {
		const client = await connect();
		const result: any = await client.callTool({
			name: "olx_get_listing",
			arguments: { id: 1 },
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not logged in");
		expect(result.content[0].text).toContain("login");
		await client.close();
	});

	test("auth status degrades gracefully when not logged in", async () => {
		const client = await connect();
		const result: any = await client.callTool({ name: "olx_auth_status", arguments: {} });

		expect(result.isError).toBeFalsy();
		const payload = JSON.parse(result.content[0].text);
		expect(payload.authenticated).toBe(false);
		// The auth file must resolve inside the sandboxed config dir, not the real one.
		expect(payload.auth_file.startsWith(configDir)).toBe(true);
		await client.close();
	});

	test("validates arguments against the tool schema", async () => {
		const client = await connect();
		const result: any = await client.callTool({
			name: "olx_sponsor_price",
			arguments: { id: 1, type: 9, days: 3, refresh_every: 0 },
		});

		expect(result.isError).toBe(true);
		await client.close();
	});

	test("rejects an image upload with no source", async () => {
		const client = await connect();
		const result: any = await client.callTool({
			name: "olx_upload_listing_images",
			arguments: { id: 1 },
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("at least one of file_paths or image_urls");
		await client.close();
	});

	// The published artifact is the bundle, not the TypeScript source, so verify it under Node.
	test("the built bundle serves the same tools under node", async () => {
		const [fromSource, fromBundle] = await Promise.all([connect(), connect("node")]);
		const source = (await fromSource.listTools()).tools.map((t) => t.name).sort();
		const bundle = (await fromBundle.listTools()).tools.map((t) => t.name).sort();

		expect(bundle).toEqual(source);
		expect(bundle.length).toBeGreaterThan(30);
		await Promise.all([fromSource.close(), fromBundle.close()]);
	});

	liveTest(
		"searches live listings without credentials",
		async () => {
			const client = await connect();
			const result: any = await client.callTool({
				name: "olx_search_listings",
				arguments: { q: "iphone", per_page: 3, sort_by: "price", sort_order: "asc" },
			});

			expect(result.isError).toBeFalsy();
			const payload = JSON.parse(result.content[0].text);
			expect(payload.data.length).toBe(3);
			expect(payload.meta.total).toBeGreaterThan(0);
			await client.close();
		},
		20_000,
	);

	liveTest(
		"the built bundle can search under node",
		async () => {
			const client = await connect("node");
			const result: any = await client.callTool({
				name: "olx_search_listings",
				arguments: { q: "laptop", per_page: 2 },
			});
			expect(result.isError).toBeFalsy();
			expect(JSON.parse(result.content[0].text).data.length).toBe(2);
			await client.close();
		},
		20_000,
	);
});

describe("cli", () => {
	async function run(args: string[], runtime: "bun" | "node" = "node") {
		const proc = Bun.spawn([runtime, runtime === "bun" ? SRC : DIST, ...args], {
			env: { PATH: process.env.PATH ?? "", OLX_MCP_CONFIG_DIR: configDir },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		return { code: await proc.exited, stdout, stderr };
	}

	test("status exits non-zero and points at the auth file when logged out", async () => {
		const { code, stdout } = await run(["status"]);
		expect(code).toBe(1);
		expect(stdout).toContain(configDir);
		expect(stdout).toContain("Not logged in");
	});

	test("logout is a no-op when nothing is saved", async () => {
		const { code, stdout } = await run(["logout"]);
		expect(code).toBe(0);
		expect(stdout).toContain("nothing to remove");
	});

	test("help and version work", async () => {
		expect((await run(["--help"])).stdout).toContain("olx-mcp login");
		expect((await run(["--version"])).stdout.trim()).toBe(pkg.version);
	});

	test("unknown commands fail loudly", async () => {
		const { code, stderr } = await run(["frobnicate"]);
		expect(code).toBe(1);
		expect(stderr).toContain("Unknown command");
	});

	test("login refuses to run without a TTY", async () => {
		const { code, stderr } = await run(["login"]);
		expect(code).toBe(1);
		expect(stderr).toContain("interactive terminal");
	});
});
