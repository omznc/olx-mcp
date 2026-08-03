import { z } from "zod";
import type { Registrar } from "./helpers.ts";
import { tool } from "./helpers.ts";
import { compactListingList, fullFlag } from "./shape.ts";

/**
 * GET /search is NOT part of the official api-documentation.olx.ba reference: it is the
 * endpoint the OLX web front-end uses, verified by hand against the live API. It works
 * without authentication. Kept in its own module so it is obvious which surface is which,
 * and so it is easy to drop if OLX changes it.
 */
export const registerSearchTools: Registrar = (server, olx) => {
	tool(
		server,
		"olx_search_listings",
		{
			title: "Search OLX listings",
			description:
				"GET /search: full-text search across public OLX listings, with category, price, " +
				"location and condition filters. Returns {data, meta:{total, last_page, current_page, " +
				"per_page}}. Each result is summarised down to the fields that identify it; " +
				"use olx_get_listing for the detail of one result.\n\n" +
				"Note: this endpoint is not part of the official OLX API reference (it is the one the " +
				"OLX website itself uses) and needs no authentication, so it may change without notice. " +
				"Every other tool in this server maps to a documented endpoint.",
			inputSchema: {
				q: z.string().optional().describe("Search query, e.g. 'iphone 13 pro'"),
				category_id: z.number().int().optional().describe("Restrict to one category"),
				brand_id: z.number().int().optional(),
				model_id: z.number().int().optional(),
				city_id: z.number().int().optional().describe("City id from olx_cities"),
				canton_id: z.number().int().optional(),
				price_from: z.number().optional().describe("Minimum price in KM"),
				price_to: z.number().optional().describe("Maximum price in KM"),
				state: z.enum(["new", "used"]).optional().describe("Item condition"),
				listing_type: z.enum(["sell", "buy", "rent"]).optional(),
				sort_by: z
					.enum(["price", "created_at", "renewed_at"])
					.optional()
					.describe("Field to sort on. Default is OLX's own relevance ordering."),
				sort_order: z.enum(["asc", "desc"]).optional(),
				page: z.number().int().min(1).optional().describe("Page number, 1-based"),
				per_page: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.describe("Results per page. Default 20; keep it small to save context."),
				full: fullFlag,
			},
		},
		async ({ full, ...args }) => {
			const payload = await olx.get("/search", { per_page: 20, ...args }, false);
			return full ? payload : compactListingList(payload);
		},
	);
};
