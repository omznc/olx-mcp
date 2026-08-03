import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { OlxApiError, OlxAuthError, type OlxClient } from "../client.ts";

export type CallResult = {
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

export function text(value: unknown): CallResult {
	return {
		content: [
			{
				type: "text",
				text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
			},
		],
	};
}

function errorText(message: string): CallResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Registers a tool, turning API/auth failures into readable isError results
 * rather than transport-level exceptions.
 */
export function tool<Shape extends ZodRawShape>(
	server: McpServer,
	name: string,
	config: { title: string; description: string; inputSchema?: Shape },
	handler: (args: any) => Promise<unknown>,
) {
	server.registerTool(
		name,
		{
			title: config.title,
			description: config.description,
			inputSchema: (config.inputSchema ?? ({} as Shape)) as Shape,
		},
		(async (args: any) => {
			try {
				return text(await handler(args ?? {}));
			} catch (error) {
				if (error instanceof OlxAuthError) return errorText(error.message);
				if (error instanceof OlxApiError)
					return errorText(
						`${error.message}\n\n(OLX returns 403/404 for endpoints your account lacks permission for, ` +
							`so a 404 here may mean "not allowed" rather than "does not exist".)`,
					);
				return errorText(
					`Unexpected error in ${name}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}) as never,
	);
}

export type Registrar = (server: McpServer, olx: OlxClient) => void;
