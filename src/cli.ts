/**
 * Terminal subcommands: `login`, `logout`, `status`.
 *
 * Logging in from a terminal rather than from an MCP tool call keeps the password out of both
 * shell history (it is never an argument) and the chat transcript (tool arguments are recorded).
 */
import { createInterface } from "node:readline";
import { OlxAuthError, OlxClient } from "./client.ts";
import { authFilePath, clearAuth, readAuth } from "./auth-store.ts";

/** Reads a line from stdin, echoing nothing when `mask` is set. */
function prompt(question: string, mask = false): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

	if (mask) {
		// Suppress echo of the typed characters, but still emit the prompt itself once.
		let promptShown = false;
		(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
			if (!promptShown) {
				process.stdout.write(question);
				promptShown = true;
			} else if (s.includes("\n")) {
				process.stdout.write("\n");
			}
		};
	}

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

async function login(): Promise<number> {
	if (!process.stdin.isTTY) {
		console.error(
			"`login` needs an interactive terminal. For scripted setups set OLX_TOKEN or " +
				"OLX_USERNAME + OLX_PASSWORD in the environment instead.",
		);
		return 1;
	}

	console.log("Log in to OLX.ba. Your password is not echoed and is never stored; only the token is saved.\n");
	const username = await prompt("Username or email: ");
	if (!username) {
		console.error("No username entered.");
		return 1;
	}
	const password = await prompt("Password: ", true);
	if (!password) {
		console.error("No password entered.");
		return 1;
	}

	try {
		const result = await new OlxClient().login(username, password, { persist: true });
		console.log(`\nLogged in as ${result.user?.username ?? username}.`);
		console.log(`Token saved to ${authFilePath()}`);
		console.log("\nRestart your MCP client to pick it up.");
		return 0;
	} catch (error) {
		console.error(
			`\nLogin failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}
}

async function logout(): Promise<number> {
	const removed = await clearAuth();
	console.log(
		removed ? `Removed ${authFilePath()}` : "No saved token found, nothing to remove.",
	);
	console.log("The token is not revoked on OLX's side; reset it there if it may be compromised.");
	return 0;
}

async function status(): Promise<number> {
	const olx = new OlxClient();
	console.log(`API:         ${olx.baseUrl}`);
	console.log(`Auth file:   ${authFilePath()}`);

	const saved = await readAuth();
	if (saved?.saved_at)
		console.log(`Saved:       ${saved.username ?? "unknown user"} at ${saved.saved_at}`);

	console.log(`Credential:  ${await olx.describeAuth()}`);

	if (!(await olx.hasCredentials())) {
		console.log("\nNot logged in. Run `olx-mcp login`.");
		return 1;
	}

	try {
		// /me wraps the account in `data`, like most OLX endpoints.
		const payload = (await olx.get("/me")) as {
			data?: { username?: string; email?: string; id?: number };
		};
		const me = payload.data ?? (payload as NonNullable<typeof payload.data>);
		console.log(`Verified:    ${me.username ?? me.email ?? me.id} (GET /me succeeded)`);
		return 0;
	} catch (error) {
		console.log(
			`Verified:    no, ${error instanceof OlxAuthError ? error.message : String(error)}`,
		);
		return 1;
	}
}

const USAGE = `olx-mcp: MCP server for the OLX.ba API

Usage:
  olx-mcp              Run the MCP server on stdio (what your MCP client invokes)
  olx-mcp login        Log in and save a token
  olx-mcp logout       Delete the saved token
  olx-mcp status       Show and verify the current credential
`;

/** Returns an exit code when it handled a subcommand, or null to start the server. */
export async function runCli(argv: string[]): Promise<number | null> {
	const command = argv[0];
	switch (command) {
		case undefined:
			return null;
		case "login":
			return login();
		case "logout":
			return logout();
		case "status":
			return status();
		case "-h":
		case "--help":
		case "help":
			console.log(USAGE);
			return 0;
		case "-v":
		case "--version":
			console.log(process.env.OLX_MCP_VERSION ?? "dev");
			return 0;
		default:
			console.error(`Unknown command: ${command}\n\n${USAGE}`);
			return 1;
	}
}
