#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runCli } from "./cli.ts";
import { OlxClient } from "./client.ts";
import { elicitLogin } from "./elicit.ts";
import { registerAuthTools } from "./tools/auth.ts";
import { registerCategoryTools } from "./tools/categories.ts";
import { registerListingTools } from "./tools/listings.ts";
import { registerLocationTools } from "./tools/locations.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerSponsoredTools } from "./tools/sponsored.ts";
import { registerUserTools } from "./tools/users.ts";

const exitCode = await runCli(process.argv.slice(2));
if (exitCode !== null) process.exit(exitCode);

const olx = new OlxClient();

const server = new McpServer(
	{ name: "olx-mcp", version: process.env.OLX_MCP_VERSION ?? "dev" },
	{
		instructions:
			"Tools for the OLX.ba marketplace API (https://api.olx.ba).\n\n" +
			"Typical flows:\n" +
			"- Browse: olx_search_listings, then olx_get_listing for detail.\n" +
			"- Post an item: olx_suggest_category -> olx_category_attributes -> olx_create_listing " +
			"(creates a DRAFT) -> olx_upload_listing_images -> olx_publish_listing.\n" +
			"- Manage: olx_user_listings to find ids, then update / hide / finish / refresh.\n\n" +
			"Money and visibility: olx_sponsor_listing charges the account's OLX balance, so always " +
			"price it with olx_sponsor_price and confirm with the user first. olx_delete_listing is " +
			"irreversible. A DRAFT listing is not a safe scratchpad: olx_update_listing publishes it, " +
			"just like olx_publish_listing, so only create listings the user agreed to post and get " +
			"the content right in olx_create_listing itself.\n\n" +
			"Auth: everything except olx_search_listings needs a login. When none is configured, the " +
			"first such tool call asks the user for credentials through this client's own login " +
			"dialog and saves a token, so just call the tool. If that is unavailable and tools " +
			"fail with an auth error, tell the user to run `olx-mcp login` in a terminal and " +
			"restart this server. Either way is preferable to olx_login, which would put their " +
			"password in the transcript.\n\n" +
			"All prices are in KM (BAM). OLX returns 403 or 404 for endpoints the account lacks " +
			"permission for, so a 404 does not always mean the resource is missing.",
	},
);

// Elicitation only works once the client has told us it supports it, which happens during
// initialize, so the prompt checks that capability lazily rather than here.
olx.setLoginPrompt(elicitLogin(server));

registerAuthTools(server, olx);
registerSearchTools(server, olx);
registerListingTools(server, olx);
registerUserTools(server, olx);
registerCategoryTools(server, olx);
registerLocationTools(server, olx);
registerSponsoredTools(server, olx);

// stdout is the MCP transport, so anything logged there corrupts the protocol.
console.error(`olx-mcp ready (base ${olx.baseUrl}, auth: ${await olx.describeAuth()})`);

await server.connect(new StdioServerTransport());
