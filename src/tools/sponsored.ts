import { z } from "zod";
import type { Registrar } from "./helpers.ts";
import { tool } from "./helpers.ts";

const sponsorShape = {
	id: z.number().int().describe("Listing id"),
	type: z
		.union([z.literal(0), z.literal(1), z.literal(2)])
		.describe("Sponsorship type: 0, 1 or 2"),
	days: z
		.union([
			z.literal(1),
			z.literal(2),
			z.literal(3),
			z.literal(5),
			z.literal(7),
			z.literal(14),
			z.literal(21),
			z.literal(30),
		])
		.describe("Duration in days: 1, 2, 3, 5, 7, 14, 21 or 30"),
	refresh_every: z
		.union([z.literal(0), z.literal(3), z.literal(6), z.literal(8), z.literal(24)])
		.describe("Auto-refresh interval in hours: 0 (never), 3, 6, 8 or 24"),
	locations: z
		.array(z.string())
		.optional()
		.describe('Extra placements, currently only ["homepage"]'),
};

export const registerSponsoredTools: Registrar = (server, olx) => {
	tool(
		server,
		"olx_sponsor_price",
		{
			title: "Price a sponsorship",
			description:
				"GET /listings/:id/sponsore/price: what a sponsorship configuration would cost, broken " +
				"down into {search, refresh, locations, extras, total}. Always price a configuration " +
				"before buying it with olx_sponsor_listing.",
			inputSchema: sponsorShape,
		},
		({ id, type, days, refresh_every, locations }) =>
			olx.get(`/listings/${id}/sponsore/price`, {
				type,
				days,
				refresh_every,
				...(locations?.length ? { "locations[]": locations.join(",") } : {}),
			}),
	);

	tool(
		server,
		"olx_sponsor_listing",
		{
			title: "Sponsor a listing",
			description:
				"POST /listings/:id/sponsore: buy promotion for a listing. THIS SPENDS MONEY from the " +
				"account's OLX balance. Check the cost with olx_sponsor_price and confirm with the user " +
				"before calling this.",
			inputSchema: sponsorShape,
		},
		({ id, type, days, refresh_every, locations }) =>
			olx.post(`/listings/${id}/sponsore`, { type, days, refresh_every, locations }),
	);

	tool(
		server,
		"olx_set_discount",
		{
			title: "Set a listing discount",
			description:
				"POST /listings/:id/discount: run a discounted price on a listing for a fixed period. " +
				"`price` is the new discounted price, not the amount off.",
			inputSchema: {
				id: z.number().int().describe("Listing id"),
				price: z.number().describe("The discounted price in KM"),
				days: z
					.union([z.literal(3), z.literal(7), z.literal(30)])
					.describe("How long the discount runs: 3, 7 or 30 days"),
			},
		},
		({ id, price, days }) => olx.post(`/listings/${id}/discount`, { price, days }),
	);

	tool(
		server,
		"olx_finish_discount",
		{
			title: "End a listing discount",
			description:
				"POST /listings/:id/discount/finish: end an active discount early and restore the original price.",
			inputSchema: { id: z.number().int().describe("Listing id") },
		},
		({ id }) => olx.post(`/listings/${id}/discount/finish`),
	);
};
