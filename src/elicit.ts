/**
 * Login prompt driven by the MCP client, via `elicitation/create`.
 *
 * The server runs as a stdio subprocess: stdin and stdout are the JSON-RPC transport, so there is
 * no terminal to ask on. Elicitation is the protocol's way to ask anyway, and it lets a fresh
 * install work with no separate `olx-mcp login` step and no restart.
 *
 * The password reaches this process over the MCP channel rather than through tool arguments, so it
 * is not part of the model's transcript, but the client may still keep its own record of what was
 * typed into the dialog. `olx-mcp login` in a terminal remains the option that keeps the password
 * strictly local; this is the convenient one.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Credentials, LoginPrompt } from "./client.ts";

/** A person has to read the dialog and type into it, so this is far longer than a request timeout. */
const ELICIT_TIMEOUT_MS = Number(process.env.OLX_ELICIT_TIMEOUT_MS ?? 300_000);

/**
 * Whether asking is worth attempting. The capability is only known after `initialize`, so this
 * has to be re-checked at call time rather than when the prompt is installed.
 */
function available(server: McpServer): boolean {
	// Opt-out for setups that would rather see a plain error than a dialog (CI, shared machines).
	if (process.env.OLX_NO_ELICIT) return false;
	// Clients that never advertised the capability would reject or ignore the request.
	return Boolean(server.server.getClientCapabilities()?.elicitation);
}

async function ask(server: McpServer): Promise<Credentials | null> {
	if (!available(server)) return null;

	let result: Awaited<ReturnType<typeof server.server.elicitInput>>;
	try {
		result = await server.server.elicitInput(
			{
				message:
					"Log in to OLX.ba to use this tool. Your password is sent to OLX in exchange " +
					"for an access token; only the token is saved on this machine.",
				requestedSchema: {
					type: "object",
					properties: {
						username: {
							type: "string",
							title: "Username or email",
							description: "Your OLX.ba account",
						},
						password: {
							type: "string",
							title: "Password",
							description: "Not stored, and not visible to the model",
						},
					},
					required: ["username", "password"],
				},
			},
			{ timeout: ELICIT_TIMEOUT_MS },
		);
	} catch {
		// Timed out, or the client claimed the capability but could not serve the request.
		return null;
	}

	if (result.action !== "accept") return null;

	const username = typeof result.content?.username === "string" ? result.content.username.trim() : "";
	const password = typeof result.content?.password === "string" ? result.content.password : "";
	return username && password ? { username, password } : null;
}

/**
 * Builds the prompt callback for `OlxClient.setLoginPrompt`.
 *
 * Parallel tool calls share one dialog: without this, a model firing three authenticated tools at
 * once would stack three login prompts.
 */
export function elicitLogin(server: McpServer): LoginPrompt {
	let inFlight: Promise<Credentials | null> | null = null;

	const prompt: LoginPrompt = () => {
		inFlight ??= ask(server).finally(() => {
			inFlight = null;
		});
		return inFlight;
	};
	prompt.available = () => available(server);
	return prompt;
}
