import { z } from "zod";
import { authFilePath, clearAuth } from "../auth-store.ts";
import type { Registrar } from "./helpers.ts";
import { DESTROYS, READS, tool, WRITES_ONCE } from "./helpers.ts";
import { compactMe } from "./shape.ts";

export const registerAuthTools: Registrar = (server, olx) => {
	tool(
		server,
		"olx_login",
		{
			title: "Log in to OLX",
			annotations: WRITES_ONCE,
			description:
				"POST /auth/login: exchange a username/email and password for a bearer token, saved " +
				"for future sessions.\n\n" +
				"PREFER TELLING THE USER TO RUN `olx-mcp login` IN A TERMINAL INSTEAD. Arguments to " +
				"this tool are recorded in the conversation transcript, so calling it puts the user's " +
				"password there. Only use it if the user explicitly asks to log in this way.",
			inputSchema: {
				username: z.string().describe("OLX username or email address"),
				password: z.string().describe("OLX account password"),
				device_name: z
					.string()
					.optional()
					.describe("Device identifier recorded against the token. Default: olx-mcp"),
			},
		},
		async ({ username, password, device_name }) => {
			const result = await olx.login(username, password, {
				deviceName: device_name,
				persist: true,
			});
			// Deliberately not echoing the token back into the transcript.
			return {
				logged_in: true,
				user: compactMe(result.user),
				token_saved_to: authFilePath(),
				note: "Token saved for future sessions. It is not shown here on purpose.",
			};
		},
	);

	tool(
		server,
		"olx_auth_status",
		{
			title: "Check OLX auth status",
			annotations: READS,
			description:
				"Report which OLX credential this server is configured with and verify it by calling " +
				"GET /me. Use this first when other tools return 401/403/404.",
		},
		async () => {
			const configured = await olx.describeAuth();
			// With a prompt available, fall through to /me so the client's login dialog opens
			// instead of reporting a dead end the user would have to fix in a terminal.
			if (!(await olx.hasCredentials()) && !olx.canPromptLogin)
				return {
					base_url: olx.baseUrl,
					credential: configured,
					auth_file: authFilePath(),
					authenticated: false,
					hint:
						"Tell the user to run `olx-mcp login` in a terminal, then restart this MCP server. " +
						"Setting OLX_TOKEN or OLX_USERNAME + OLX_PASSWORD in the server env also works.",
				};
			const me = await olx.get("/me");
			return {
				base_url: olx.baseUrl,
				credential: configured,
				auth_file: authFilePath(),
				authenticated: true,
				me: compactMe(me),
			};
		},
	);

	tool(
		server,
		"olx_logout",
		{
			title: "Log out of OLX",
			annotations: { ...DESTROYS, openWorldHint: false },
			description:
				"Delete the saved OLX token from disk. Does not revoke the token on OLX's side. " +
				"reset it in your OLX account settings if you think it was compromised.",
		},
		async () => {
			const removed = await clearAuth();
			olx.clearToken();
			return {
				removed,
				auth_file: authFilePath(),
				note: removed
					? "Saved token deleted. It is still valid on OLX's side until reset there."
					: "No saved token was found.",
			};
		},
	);
};
