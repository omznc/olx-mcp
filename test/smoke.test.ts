import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SRC = new URL("../src/index.ts", import.meta.url).pathname;
const DIST = new URL("../dist/index.js", import.meta.url).pathname;

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
			// No credentials: exercises the unauthenticated paths and the auth error handling.
			env: { PATH: process.env.PATH ?? "", OLX_MCP_CONFIG_DIR: configDir },
		}),
	);
	return client;
}

describe("olx-mcp", () => {
	test("exposes every tool with a schema", async () => {
		const client = await connect();
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();

		expect(names).toContain("olx_search_listings");
		expect(names).toContain("olx_create_listing");
		expect(names).toContain("olx_sponsor_price");
		expect(names).toContain("olx_logout");
		expect(names.length).toBe(36);
		for (const t of tools) {
			expect(t.description?.length).toBeGreaterThan(20);
			expect(t.inputSchema.type).toBe("object");
		}
		await client.close();
	});

	test("searches live listings without credentials", async () => {
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
	}, 20_000);

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

	// The published artifact is the bundle, not the TypeScript source, so verify it under Node.
	test("the built bundle serves the same tools under node", async () => {
		const client = await connect("node");
		const { tools } = await client.listTools();

		expect(tools.length).toBe(36);
		const result: any = await client.callTool({
			name: "olx_search_listings",
			arguments: { q: "laptop", per_page: 2 },
		});
		expect(result.isError).toBeFalsy();
		expect(JSON.parse(result.content[0].text).data.length).toBe(2);
		await client.close();
	}, 20_000);
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
		expect((await run(["--version"])).stdout.trim()).toBe("1.0.0");
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
