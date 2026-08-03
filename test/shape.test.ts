import { describe, expect, test } from "bun:test";
import {
	compactAttributes,
	compactCategories,
	compactCities,
	compactListing,
	compactListingList,
	compactMe,
} from "../src/tools/shape.ts";

describe("compactMe", () => {
	test("keeps identity and balance, drops the noise", () => {
		const out = compactMe({
			data: {
				id: 1,
				username: "someone",
				credits: 104,
				location: { id: 24, name: "Livno", canton_id: 10, lat: 43.8, lng: 17.0 },
				notifications: { email: true, push: true },
				medals: [{ id: 1 }, { id: 2 }],
			},
		}) as Record<string, unknown>;

		expect(out.username).toBe("someone");
		expect(out.credits).toBe(104);
		expect(out.location).toEqual({ id: 24, name: "Livno", canton_id: 10 });
		expect(out.notifications).toBeUndefined();
		expect(out.medals).toBeUndefined();
	});
});

describe("compactListingList", () => {
	test("trims cards but keeps pagination", () => {
		const out = compactListingList({
			data: [
				{
					id: 7,
					title: "Bicikl",
					price: 200,
					category: { id: 3, name: "Sport", slug: "sport", parent_id: 1 },
					aggregations: { irrelevant: true },
				},
			],
			meta: { total: 41, current_page: 1, last_page: 3, per_page: 20, path: "/search" },
		}) as Record<string, any>;

		expect(out.data[0]).toEqual({
			id: 7,
			title: "Bicikl",
			price: 200,
			category: { id: 3, name: "Sport" },
		});
		expect(out.meta).toEqual({ total: 41, current_page: 1, last_page: 3, per_page: 20 });
	});
});

describe("compactListing", () => {
	test("lifts the description out of `additional`", () => {
		const out = compactListing({
			data: {
				id: 9,
				title: "Sto",
				additional: { description: "<p>Kao nov</p>", extra: "x" },
				attributes: [{ id: 1, name: "Boja", value: "Crna", legacy: true }],
			},
		}) as Record<string, any>;

		expect(out.description).toBe("<p>Kao nov</p>");
		expect(out.additional).toBeUndefined();
		expect(out.attributes).toEqual([{ id: 1, name: "Boja", value: "Crna" }]);
	});

	test("passes unrecognised payloads through untouched", () => {
		const payload = { message: "Nešto je pošlo po zlu" };
		expect(compactListing(payload)).toBe(payload);
	});
});

describe("compactCities", () => {
	const tree = {
		data: [
			{
				name: "Federacija BiH",
				cantons: [
					{
						id: 1,
						name: "Unsko-sanski kanton",
						cities: [{ id: 3, name: "Bihać", zip: "77000", lat: 44.8 }],
					},
				],
			},
		],
	};

	test("keeps the grouping and strips city detail", () => {
		expect(compactCities(tree)).toEqual({
			data: [
				{
					state: "Federacija BiH",
					cantons: [{ id: 1, name: "Unsko-sanski kanton", cities: [{ id: 3, name: "Bihać" }] }],
				},
			],
		});
	});

	test("handles a flat city list too", () => {
		const flat = { data: [{ id: 3, name: "Bihać", code: "BIH", lat: 44.8 }] };
		expect(compactCities(flat)).toEqual({ data: [{ id: 3, name: "Bihać", code: "BIH" }] });
	});
});

describe("compactCategories and compactAttributes", () => {
	test("categories keep the flags that decide listing fields", () => {
		const out = compactCategories({
			data: [{ id: 1, name: "Vozila", show_brand: true, icon: "car.svg", banner: "…" }],
		}) as Record<string, any>;

		expect(out.data[0]).toEqual({ id: 1, name: "Vozila", show_brand: true });
	});

	test("attributes keep options and top-level flags", () => {
		const out = compactAttributes({
			data: [{ id: 7, display_name: "Stanje", required: true, options: ["Novo"], sort: 3 }],
			show_brand: true,
			some_other_flag: "dropped",
		}) as Record<string, any>;

		expect(out.data[0]).toEqual({
			id: 7,
			display_name: "Stanje",
			required: true,
			options: ["Novo"],
		});
		expect(out.show_brand).toBe(true);
		expect(out.some_other_flag).toBeUndefined();
	});
});
