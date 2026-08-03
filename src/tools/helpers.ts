import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z, ZodObject, ZodRawShape } from "zod";
import { OlxApiError, OlxAuthError, type OlxClient, OlxTimeoutError } from "../client.ts";

export type CallResult = {
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

/**
 * MCP tool annotations. Clients use these to decide what to auto-approve, so unlike the
 * warnings in the descriptions they do not depend on the model reading them.
 */
export type Annotations = {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
};

/** Reads OLX and changes nothing. */
export const READS: Annotations = {
	readOnlyHint: true,
	idempotentHint: true,
	openWorldHint: true,
};

/** Changes OLX, but repeating it lands in the same state (hide, unhide, set main image). */
export const WRITES: Annotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
};

/** Changes OLX, and every call has its own effect (create a listing, add images, refresh). */
export const WRITES_ONCE: Annotations = { ...WRITES, idempotentHint: false };

/** Destroys data or spends the account balance. Clients should always confirm these. */
export const DESTROYS: Annotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
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
	config: {
		title: string;
		description: string;
		annotations: Annotations;
		inputSchema?: Shape;
	},
	handler: (args: z.infer<ZodObject<Shape>>) => unknown,
) {
	server.registerTool(
		name,
		{
			title: config.title,
			description: config.description,
			annotations: { title: config.title, ...config.annotations },
			inputSchema: (config.inputSchema ?? ({} as Shape)) as Shape,
		},
		(async (args: z.infer<ZodObject<Shape>>) => {
			try {
				return text(await handler(args ?? ({} as z.infer<ZodObject<Shape>>)));
			} catch (error) {
				if (error instanceof OlxAuthError) return errorText(error.message);
				if (error instanceof OlxTimeoutError) return errorText(error.message);
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
