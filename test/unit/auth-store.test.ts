import { stat, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { authFilePath, clearAuth, configDir, readAuth, writeAuth } from "../../src/auth-store.ts";

let dir: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
	savedConfigDir = process.env.OLX_MCP_CONFIG_DIR;
	dir = await mkdtemp(join(tmpdir(), "olx-auth-"));
	process.env.OLX_MCP_CONFIG_DIR = join(dir, "config");
});

afterEach(async () => {
	if (savedConfigDir === undefined) delete process.env.OLX_MCP_CONFIG_DIR;
	else process.env.OLX_MCP_CONFIG_DIR = savedConfigDir;
	await rm(dir, { recursive: true, force: true });
});

describe("auth store", () => {
	test("round-trips a token", async () => {
		await writeAuth({ token: "abc", username: "me", saved_at: "2026-01-01T00:00:00Z" });
		expect(await readAuth()).toEqual({
			token: "abc",
			username: "me",
			saved_at: "2026-01-01T00:00:00Z",
		});
	});

	test("the token file is readable only by its owner", async () => {
		await writeAuth({ token: "abc", saved_at: "2026-01-01T00:00:00Z" });
		const mode = (await stat(authFilePath())).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("overwriting an existing file keeps the restrictive mode", async () => {
		await writeAuth({ token: "first", saved_at: "2026-01-01T00:00:00Z" });
		// writeFile's `mode` only applies on create, so a loosened file must be re-tightened.
		await writeFile(authFilePath(), "{}", { mode: 0o644 });
		await writeAuth({ token: "second", saved_at: "2026-01-02T00:00:00Z" });

		expect((await stat(authFilePath())).mode & 0o777).toBe(0o600);
		expect((await readAuth())?.token).toBe("second");
	});

	test("a missing file reads as not-logged-in rather than throwing", async () => {
		expect(await readAuth()).toBeNull();
	});

	test("a corrupt file reads as not-logged-in", async () => {
		await writeAuth({ token: "abc", saved_at: "2026-01-01T00:00:00Z" });
		await writeFile(authFilePath(), "not json at all");
		expect(await readAuth()).toBeNull();
	});

	test("a file with no token reads as not-logged-in", async () => {
		await writeAuth({ token: "abc", saved_at: "2026-01-01T00:00:00Z" });
		await writeFile(authFilePath(), JSON.stringify({ username: "me" }));
		expect(await readAuth()).toBeNull();
	});

	test("clearAuth removes the file and is a no-op the second time", async () => {
		await writeAuth({ token: "abc", saved_at: "2026-01-01T00:00:00Z" });
		expect(await clearAuth()).toBe(true);
		expect(await clearAuth()).toBe(false);
		expect(await readAuth()).toBeNull();
	});

	test("OLX_MCP_CONFIG_DIR overrides the platform default", () => {
		expect(configDir()).toBe(join(dir, "config"));
		expect(authFilePath()).toBe(join(dir, "config", "auth.json"));
	});
});
