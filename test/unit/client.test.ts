import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OlxApiError, OlxAuthError, OlxClient, OlxTimeoutError } from "../../src/client.ts";

type Reply =
	| { status: number; body?: unknown; headers?: Record<string, string> }
	| { throws: Error };

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
}

let calls: Call[] = [];
const realFetch = globalThis.fetch;

/** Replaces fetch with one that replays `replies` in order, recording what it was sent. */
function stubFetch(replies: Reply[]) {
	let index = 0;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const reply = replies[index++];
		if (!reply) throw new Error(`Unexpected fetch call #${index} to ${String(input)}`);

		calls.push({
			url: String(input),
			method: init?.method ?? "GET",
			headers: { ...((init?.headers ?? {}) as Record<string, string>) },
			body: typeof init?.body === "string" ? init.body : undefined,
		});

		if ("throws" in reply) throw reply.throws;
		return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
			status: reply.status,
			headers: reply.headers,
		});
	}) as typeof fetch;
}

const timeoutError = () => Object.assign(new Error("The operation timed out."), {
	name: "TimeoutError",
});

const OWNED_ENV = [
	"OLX_TOKEN",
	"OLX_USERNAME",
	"OLX_PASSWORD",
	"OLX_CLIENT_ID",
	"OLX_CLIENT_TOKEN",
	"OLX_MCP_CONFIG_DIR",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	calls = [];
	saved = Object.fromEntries(OWNED_ENV.map((key) => [key, process.env[key]]));
	for (const key of OWNED_ENV) delete process.env[key];
	// A directory that does not exist, so no real saved token leaks in.
	process.env.OLX_MCP_CONFIG_DIR = "/nonexistent/olx-mcp-test";
});

afterEach(() => {
	globalThis.fetch = realFetch;
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const bearer = (call: Call) => call.headers.Authorization;

describe("token renewal", () => {
	test("re-logs in and retries once when OLX rejects the token", async () => {
		process.env.OLX_USERNAME = "user";
		process.env.OLX_PASSWORD = "pw";
		stubFetch([
			{ status: 200, body: { token: "first", user: { username: "user" } } },
			{ status: 401, body: { message: "Unauthenticated." } },
			{ status: 200, body: { token: "second", user: { username: "user" } } },
			{ status: 200, body: { data: { id: 7 } } },
		]);

		const result = await new OlxClient().get("/me");

		expect(result).toEqual({ data: { id: 7 } });
		expect(calls).toHaveLength(4);
		expect(bearer(calls[1] as Call)).toBe("Bearer first");
		expect(bearer(calls[3] as Call)).toBe("Bearer second");
	});

	test("re-logs in at most once per request", async () => {
		process.env.OLX_USERNAME = "user";
		process.env.OLX_PASSWORD = "pw";
		stubFetch([
			{ status: 200, body: { token: "first", user: {} } },
			{ status: 401 },
			{ status: 200, body: { token: "second", user: {} } },
			{ status: 401 },
		]);

		await expect(new OlxClient().get("/me")).rejects.toBeInstanceOf(OlxAuthError);
		expect(calls).toHaveLength(4);
	});

	test("a bare OLX_TOKEN cannot be renewed, so a 401 fails immediately", async () => {
		process.env.OLX_TOKEN = "static";
		stubFetch([{ status: 401 }]);

		await expect(new OlxClient().get("/me")).rejects.toThrow(/rejected the token/);
		expect(calls).toHaveLength(1);
	});

	test("a failed re-login reports the original auth failure", async () => {
		process.env.OLX_USERNAME = "user";
		process.env.OLX_PASSWORD = "pw";
		stubFetch([
			{ status: 200, body: { token: "first", user: {} } },
			{ status: 401 },
			{ status: 422, body: { message: "These credentials do not match our records." } },
		]);

		await expect(new OlxClient().get("/me")).rejects.toBeInstanceOf(OlxAuthError);
	});
});

describe("credential precedence", () => {
	test("a saved token wins over the legacy client headers", async () => {
		process.env.OLX_CLIENT_ID = "cid";
		process.env.OLX_CLIENT_TOKEN = "ctok";
		stubFetch([{ status: 200, body: {} }]);

		const client = new OlxClient();
		client.setToken("saved");
		await client.get("/me");

		// Regression: authHeaders used to read the token before the store had been consulted,
		// which handed the request to the legacy headers instead.
		expect(bearer(calls[0] as Call)).toBe("Bearer saved");
		expect(calls[0]?.headers["OLX-CLIENT-ID"]).toBeUndefined();
	});

	test("legacy client headers are used when there is no bearer credential", async () => {
		process.env.OLX_CLIENT_ID = "cid";
		process.env.OLX_CLIENT_TOKEN = "ctok";
		stubFetch([{ status: 200, body: {} }]);

		await new OlxClient().get("/me");

		expect(calls[0]?.headers["OLX-CLIENT-ID"]).toBe("cid");
		expect(bearer(calls[0] as Call)).toBeUndefined();
	});

	test("clearToken drops the token without falling back to the store", async () => {
		const client = new OlxClient();
		client.setToken("saved");
		expect(await client.hasCredentials()).toBe(true);

		client.clearToken();
		expect(await client.hasCredentials()).toBe(false);
		await expect(client.get("/me")).rejects.toThrow(/Not logged in/);
	});

	test("with no credentials at all, requests fail before reaching the network", async () => {
		stubFetch([]);
		await expect(new OlxClient().get("/me")).rejects.toBeInstanceOf(OlxAuthError);
		expect(calls).toHaveLength(0);
	});
});

describe("retries", () => {
	test("retries a 429 and returns the eventual success", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ status: 429 }, { status: 200, body: { ok: true } }]);

		expect(await new OlxClient().get<{ ok: boolean }>("/categories")).toEqual({ ok: true });
		expect(calls).toHaveLength(2);
	});

	test("gives up after the retry budget and reports the last status", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ status: 429 }, { status: 429 }, { status: 429 }]);

		const error: unknown = await new OlxClient().get("/categories").catch((e) => e);
		expect(error).toBeInstanceOf(OlxApiError);
		expect((error as OlxApiError).status).toBe(429);
		expect(calls).toHaveLength(3);
	});

	test("honours Retry-After instead of the default backoff", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([
			{ status: 429, headers: { "retry-after": "0.05" } },
			{ status: 200, body: { ok: true } },
		]);

		const started = performance.now();
		await new OlxClient().get("/categories");
		const elapsed = performance.now() - started;

		// 50ms from the header, well short of the 500ms first backoff step.
		expect(elapsed).toBeGreaterThanOrEqual(40);
		expect(elapsed).toBeLessThan(400);
	});

	test("retries a 5xx on GET", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ status: 502 }, { status: 200, body: { ok: true } }]);

		expect(await new OlxClient().get<{ ok: boolean }>("/categories")).toEqual({ ok: true });
		expect(calls).toHaveLength(2);
	});

	test("does NOT retry a 5xx on POST, which may already have applied the write", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ status: 500 }]);

		await expect(new OlxClient().post("/listings", { title: "x" })).rejects.toBeInstanceOf(
			OlxApiError,
		);
		expect(calls).toHaveLength(1);
	});

	test("does not retry an ordinary 4xx", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ status: 404, body: { message: "Not found" } }]);

		await expect(new OlxClient().get("/listings/1")).rejects.toBeInstanceOf(OlxApiError);
		expect(calls).toHaveLength(1);
	});
});

describe("timeouts", () => {
	test("a timed-out POST surfaces as OlxTimeoutError without repeating the write", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ throws: timeoutError() }]);

		await expect(new OlxClient().post("/listings", {})).rejects.toBeInstanceOf(OlxTimeoutError);
		expect(calls).toHaveLength(1);
	});

	test("a timed-out GET is retried before giving up", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ throws: timeoutError() }, { status: 200, body: { ok: true } }]);

		expect(await new OlxClient().get<{ ok: boolean }>("/categories")).toEqual({ ok: true });
		expect(calls).toHaveLength(2);
	});

	test("the timeout message names the endpoint and the limit", async () => {
		process.env.OLX_TOKEN = "t";
		stubFetch([{ throws: timeoutError() }]);

		const error: unknown = await new OlxClient().post("/listings/1/publish").catch((e) => e);
		expect((error as Error).message).toContain("/listings/1/publish");
		expect((error as Error).message).toContain("OLX_TIMEOUT_MS");
	});
});

describe("request shaping", () => {
	test("drops empty query values and keeps the rest", async () => {
		stubFetch([{ status: 200, body: {} }]);

		await new OlxClient().get("/search", { q: "car", page: 2, city_id: undefined }, false);

		const url = new URL(calls[0]?.url ?? "");
		expect(url.searchParams.get("q")).toBe("car");
		expect(url.searchParams.get("page")).toBe("2");
		expect(url.searchParams.has("city_id")).toBe(false);
		expect(bearer(calls[0] as Call)).toBeUndefined();
	});

	test("passes a non-JSON error body through rather than swallowing it", async () => {
		process.env.OLX_TOKEN = "t";
		globalThis.fetch = (async () =>
			new Response("<html>gateway error</html>", { status: 503 })) as unknown as typeof fetch;

		const error: unknown = await new OlxClient().post("/listings", {}).catch((e) => e);
		expect(error).toBeInstanceOf(OlxApiError);
		expect(String((error as OlxApiError).body)).toContain("gateway error");
	});
});
