import { z } from "zod";
import type { Registrar } from "./helpers.ts";
import { READS, tool } from "./helpers.ts";
import { compactCities, fullFlag } from "./shape.ts";

export const registerLocationTools: Registrar = (server, olx) => {
	tool(
		server,
		"olx_cities",
		{
			title: "List cities",
			annotations: READS,
			description:
				"GET /cities: every city in the country, grouped by entity and canton, as " +
				"{id, name} pairs. Use the id as city_id. This is a long list, so if you already know " +
				"the canton, olx_canton_cities is cheaper. full=true adds coordinates and zip codes.",
			inputSchema: { full: fullFlag },
		},
		async ({ full }) => {
			const payload = await olx.get("/cities");
			return full ? payload : compactCities(payload);
		},
	);

	tool(
		server,
		"olx_city",
		{
			title: "Get a city",
			annotations: READS,
			description:
				"GET /cities/:id: detail for one city (zip code, coordinates, country/canton/state ids).",
			inputSchema: { id: z.number().int().describe("City id") },
		},
		({ id }) => olx.get(`/cities/${id}`),
	);

	tool(
		server,
		"olx_countries",
		{
			title: "List countries",
			annotations: READS,
			description: "GET /countries: all countries, with id, name and code. Use the id as country_id.",
		},
		() => olx.get("/countries"),
	);

	tool(
		server,
		"olx_country_states",
		{
			title: "List country states",
			annotations: READS,
			description:
				"GET /country-states: entities/states of Bosnia and Herzegovina, each with its cantons.",
		},
		() => olx.get("/country-states"),
	);

	tool(
		server,
		"olx_canton_cities",
		{
			title: "List cities in a canton",
			annotations: READS,
			description:
				"GET /cantons/:id/cities: cities in one canton, with coordinates. " +
				"Canton ids come from olx_country_states.",
			inputSchema: { id: z.number().int().describe("Canton id") },
		},
		({ id }) => olx.get(`/cantons/${id}/cities`),
	);
};
