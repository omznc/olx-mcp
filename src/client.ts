/**
 * Thin HTTP client for the OLX.ba API (https://api.olx.ba).
 *
 * Auth resolution order, highest priority first:
 *   1. A token set at runtime (by `olx-mcp login` or the `olx_login` tool).
 *   2. OLX_TOKEN                        -> Authorization: Bearer <token>
 *   3. The saved token from `olx-mcp login` (see auth-store.ts)
 *   4. OLX_USERNAME + OLX_PASSWORD      -> lazy POST /auth/login
 *   5. OLX_CLIENT_ID + OLX_CLIENT_TOKEN -> legacy OLX-CLIENT-* headers
 *
 * Env vars win over the saved token so CI and headless setups can override a local login.
 *
 * Only (4) can mint a fresh token, so it is the one setup that survives an expiry on its own:
 * when OLX rejects the token, the request re-logs in once and retries. The others surface an
 * OlxAuthError telling the user to log in again.
 */
import { readAuth, writeAuth } from "./auth-store.ts";

const BASE_URL = process.env.OLX_BASE_URL ?? "https://api.olx.ba";

const TIMEOUT_MS = Number(process.env.OLX_TIMEOUT_MS ?? 30_000);
const MAX_RETRIES = 2;

export class OlxApiError extends Error {
	constructor(
		readonly status: number,
		readonly method: string,
		readonly path: string,
		readonly body: unknown,
	) {
		super(
			`OLX API ${method} ${path} failed with HTTP ${status}: ${
				typeof body === "string" ? body : JSON.stringify(body)
			}`,
		);
		this.name = "OlxApiError";
	}
}

export class OlxAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OlxAuthError";
	}
}

export class OlxTimeoutError extends Error {
	constructor(
		readonly method: string,
		readonly path: string,
		readonly timeoutMs: number,
	) {
		super(
			`OLX API ${method} ${path} did not respond within ${timeoutMs}ms. ` +
				"OLX may be slow or unreachable; try again, or raise OLX_TIMEOUT_MS.",
		);
		this.name = "OlxTimeoutError";
	}
}

export interface LoginResult {
	token: string;
	user: {
		id: number;
		type: string;
		email: string;
		username: string;
		first_name?: string;
		last_name?: string;
	};
}

type Query = Record<string, string | number | boolean | undefined | null>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const backoffMs = (attempt: number) => 500 * 2 ** attempt;

function isTimeout(error: unknown): boolean {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** A 5xx may already have applied the write, so only GET is repeated. */
function retryable(method: string, status: number): boolean {
	if (status === 429) return true;
	return status >= 500 && method === "GET";
}

function retryAfterMs(response: Response): number | null {
	const header = response.headers.get("retry-after");
	if (!header) return null;
	const seconds = Number(header);
	const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
	return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 10_000) : null;
}

const NOT_LOGGED_IN =
	"Not logged in to OLX. Run `npx -y @omznc/olx-mcp login` in a terminal " +
	"(it prompts for your username and password and saves a token), then restart this MCP server. " +
	"Alternatively set OLX_TOKEN or OLX_USERNAME + OLX_PASSWORD in the server env.";

export class OlxClient {
	/** Token held in memory: from OLX_TOKEN, a runtime login, or the saved auth file. */
	private token: string | null = process.env.OLX_TOKEN?.trim() || null;
	/** Set once the auth file has been consulted, so it is read at most once. */
	private storeChecked = false;
	/** In-flight login promise, so concurrent calls share one login round-trip. */
	private loginInFlight: Promise<string> | null = null;

	get baseUrl() {
		return BASE_URL;
	}

	/** Loads the saved token, unless an env token already took priority. */
	private async loadStoredToken(): Promise<void> {
		if (this.storeChecked || this.token) {
			this.storeChecked = true;
			return;
		}
		this.storeChecked = true;
		const saved = await readAuth();
		if (saved) this.token = saved.token;
	}

	/** True when some credential is available, which is not a guarantee that it is valid. */
	async hasCredentials(): Promise<boolean> {
		await this.loadStoredToken();
		return Boolean(
			this.token ||
				(process.env.OLX_USERNAME && process.env.OLX_PASSWORD) ||
				(process.env.OLX_CLIENT_ID && process.env.OLX_CLIENT_TOKEN),
		);
	}

	async describeAuth(): Promise<string> {
		await this.loadStoredToken();
		if (process.env.OLX_TOKEN?.trim()) return "bearer token from OLX_TOKEN";
		if (this.token) return "saved token from `olx-mcp login`";
		if (process.env.OLX_USERNAME && process.env.OLX_PASSWORD)
			return `username/password from env (${process.env.OLX_USERNAME}, not yet exchanged for a token)`;
		if (process.env.OLX_CLIENT_ID && process.env.OLX_CLIENT_TOKEN)
			return "legacy OLX-CLIENT-ID / OLX-CLIENT-TOKEN";
		return "not logged in";
	}

	setToken(token: string) {
		this.token = token || null;
		this.storeChecked = true;
	}

	clearToken() {
		this.token = null;
		// Marked as read, so the token just cleared is not reloaded from disk.
		this.storeChecked = true;
	}

	private renewableCredentials(): { username: string; password: string } | null {
		const username = process.env.OLX_USERNAME;
		const password = process.env.OLX_PASSWORD;
		return username && password ? { username, password } : null;
	}

	/**
	 * The new token is deliberately not persisted: the auth file belongs to `olx-mcp login`,
	 * and a process running on env credentials should not rewrite it behind the user's back.
	 */
	private async reauthenticate(): Promise<boolean> {
		const credentials = this.renewableCredentials();
		if (!credentials) return false;
		this.clearToken();
		try {
			await this.login(credentials.username, credentials.password);
			return true;
		} catch {
			// Re-login failed too, so let the caller report the original 401.
			return false;
		}
	}

	/**
	 * POST /auth/login: exchanges credentials for a bearer token.
	 * With `persist`, the token is also written to the auth file for future runs.
	 */
	async login(
		username: string,
		password: string,
		{ deviceName = "olx-mcp", persist = false } = {},
	): Promise<LoginResult> {
		const result = await this.request<LoginResult>("POST", "/auth/login", {
			body: { username, password, device_name: deviceName },
			auth: false,
		});
		if (!result?.token)
			throw new OlxAuthError("Login succeeded but no token was returned.");
		this.setToken(result.token);
		if (persist)
			await writeAuth({
				token: result.token,
				username: result.user?.username ?? username,
				saved_at: new Date().toISOString(),
			});
		return result;
	}

	/** Resolves a bearer token, logging in with env credentials if needed. */
	private async ensureToken(): Promise<string> {
		await this.loadStoredToken();
		if (this.token) return this.token;

		const credentials = this.renewableCredentials();
		if (!credentials) throw new OlxAuthError(NOT_LOGGED_IN);

		this.loginInFlight ??= this.login(credentials.username, credentials.password)
			.then((r) => r.token)
			.finally(() => {
				this.loginInFlight = null;
			});
		return this.loginInFlight;
	}

	private async authHeaders(): Promise<Record<string, string>> {
		// Before reading this.token: on the first request the saved token is not loaded yet,
		// and without this a saved token would lose to the legacy header pair.
		await this.loadStoredToken();
		const clientId = process.env.OLX_CLIENT_ID;
		const clientToken = process.env.OLX_CLIENT_TOKEN;
		// Legacy header pair only applies when no bearer credential exists at all.
		if (!this.token && !this.renewableCredentials() && clientId && clientToken) {
			return { "OLX-CLIENT-ID": clientId, "OLX-CLIENT-TOKEN": clientToken };
		}
		return { Authorization: `Bearer ${await this.ensureToken()}` };
	}

	async request<T = unknown>(
		method: string,
		path: string,
		opts: {
			query?: Query;
			body?: unknown;
			formData?: FormData;
			auth?: boolean;
		} = {},
	): Promise<T> {
		const { query, body, formData, auth = true } = opts;

		const url = new URL(path.startsWith("/") ? path.slice(1) : path, `${BASE_URL}/`);
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined && value !== null && value !== "")
				url.searchParams.set(key, String(value));
		}

		// One re-login per request at most, so a permanently invalid credential cannot loop.
		let authRetried = false;
		let attempt = 0;

		for (;;) {
			const headers: Record<string, string> = { Accept: "application/json" };
			if (auth) Object.assign(headers, await this.authHeaders());

			let payload: FormData | string | undefined;
			if (formData) {
				payload = formData; // fetch sets the multipart boundary itself
			} else if (body !== undefined) {
				headers["Content-Type"] = "application/json";
				payload = JSON.stringify(body);
			}

			let response: Response;
			try {
				response = await fetch(url, {
					method,
					headers,
					body: payload,
					signal: AbortSignal.timeout(TIMEOUT_MS),
				});
			} catch (error) {
				// Only GET is safe to repeat blindly.
				if (method === "GET" && attempt < MAX_RETRIES) {
					await sleep(backoffMs(attempt++));
					continue;
				}
				if (isTimeout(error)) throw new OlxTimeoutError(method, path, TIMEOUT_MS);
				throw error;
			}

			const text = await response.text();

			let parsed: unknown = text;
			if (text) {
				try {
					parsed = JSON.parse(text);
				} catch {
					// Non-JSON body (HTML error page, plain text). Pass it through as-is.
				}
			}

			if (response.ok) return parsed as T;

			if (response.status === 401 && auth && !authRetried) {
				authRetried = true;
				if (await this.reauthenticate()) continue;
			}

			if (retryable(method, response.status) && attempt < MAX_RETRIES) {
				const delay = retryAfterMs(response) ?? backoffMs(attempt);
				attempt++;
				await sleep(delay);
				continue;
			}

			// Includes the case where the re-login above cleared the rejected token.
			if (response.status === 401 && auth)
				throw new OlxAuthError(
					`OLX API rejected the token (HTTP 401 on ${method} ${path}). ` +
						"It may have expired. Run `olx-mcp login` again, or refresh OLX_TOKEN. " +
						"With OLX_USERNAME and OLX_PASSWORD set, the server renews the token itself.",
				);
			throw new OlxApiError(response.status, method, path, parsed);
		}
	}

	get<T = unknown>(path: string, query?: Query, auth = true) {
		return this.request<T>("GET", path, { query, auth });
	}
	post<T = unknown>(path: string, body?: unknown, query?: Query) {
		return this.request<T>("POST", path, { body, query });
	}
	put<T = unknown>(path: string, body?: unknown) {
		return this.request<T>("PUT", path, { body });
	}
	delete<T = unknown>(path: string) {
		return this.request<T>("DELETE", path);
	}
}
