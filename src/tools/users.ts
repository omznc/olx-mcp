import { z } from "zod";
import type { Registrar } from "./helpers.ts";
import { tool } from "./helpers.ts";
import { compactListingList, compactMe, fullFlag } from "./shape.ts";

const STATES = {
	active: (u: string) => `/users/${u}/listings`,
	finished: (u: string) => `/users/${u}/listings/finished`,
	inactive: (u: string) => `/users/${u}/listings/inactive`,
	expired: (u: string) => `/users/${u}/listings/expired`,
	hidden: (u: string) => `/users/${u}/listings/hidden`,
} as const;

export const registerUserTools: Registrar = (server, olx) => {
	tool(
		server,
		"olx_me",
		{
			title: "Get the authenticated user",
			description:
				"GET /me: the account the current token belongs to. Returns the identity, contact " +
				"and credit-balance fields; pass full=true to also get notification settings, " +
				"medals and the rest of the raw profile.",
			inputSchema: { full: fullFlag },
		},
		async ({ full }) => {
			const payload = await olx.get("/me");
			return full ? payload : compactMe(payload);
		},
	);

	tool(
		server,
		"olx_user_listings",
		{
			title: "List a user's listings",
			description:
				"List a user's listings in a given state. Wraps the five documented endpoints:\n" +
				"  active   -> GET /users/:username/listings\n" +
				"  finished -> GET /users/:id/listings/finished\n" +
				"  inactive -> GET /users/:id/listings/inactive\n" +
				"  expired  -> GET /users/:id/listings/expired\n" +
				"  hidden   -> GET /users/:id/listings/hidden\n" +
				"Results are paginated; the `meta` object in the response carries the page count. " +
				"Each listing is summarised; use olx_get_listing, or full=true, for everything.",
			inputSchema: {
				user: z
					.union([z.string(), z.number()])
					.describe(
						"Username (for active listings) or numeric user id. Use olx_me to find your own.",
					),
				state: z
					.enum(["active", "finished", "inactive", "expired", "hidden"])
					.default("active")
					.describe("Which set of listings to return"),
				page: z.number().int().min(1).optional().describe("Page number, 1-based"),
				full: fullFlag,
			},
		},
		async ({ user, state = "active", page, full }) => {
			const payload = await olx.get(STATES[state as keyof typeof STATES](String(user)), { page });
			return full ? payload : compactListingList(payload);
		},
	);
};
