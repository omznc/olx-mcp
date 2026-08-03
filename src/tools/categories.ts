import { z } from "zod";
import type { Registrar } from "./helpers.ts";
import { tool } from "./helpers.ts";
import { compactAttributes, compactCategories, fullFlag } from "./shape.ts";

export const registerCategoryTools: Registrar = (server, olx) => {
	tool(
		server,
		"olx_categories",
		{
			title: "List categories",
			description:
				"GET /categories, or GET /categories/:id for the children of one category. " +
				"Call without arguments to get the top-level tree, then drill down by parent_id.",
			inputSchema: {
				parent_id: z
					.number()
					.int()
					.optional()
					.describe("Return the child categories of this category instead of the root list"),
				full: fullFlag,
			},
		},
		async ({ parent_id, full }) => {
			const payload = await olx.get(
				parent_id === undefined ? "/categories" : `/categories/${parent_id}`,
			);
			return full ? payload : compactCategories(payload);
		},
	);

	tool(
		server,
		"olx_category",
		{
			title: "Get one category",
			description: "GET /category/:id: full detail for a single category.",
			inputSchema: { id: z.number().int().describe("Category id") },
		},
		({ id }) => olx.get(`/category/${id}`),
	);

	tool(
		server,
		"olx_category_attributes",
		{
			title: "Get category attributes",
			description:
				"GET /categories/:id/attributes: the attribute schema for a category (id, name, " +
				"input_type, options, required). Call this before olx_create_listing so you know " +
				"which attributes that category requires and what values it accepts.",
			inputSchema: { id: z.number().int().describe("Category id"), full: fullFlag },
		},
		async ({ id, full }) => {
			const payload = await olx.get(`/categories/${id}/attributes`);
			return full ? payload : compactAttributes(payload);
		},
	);

	tool(
		server,
		"olx_category_brands",
		{
			title: "List category brands",
			description:
				"GET /categories/:id/brands: brands available in a category (cars, phones, and similar).",
			inputSchema: { id: z.number().int().describe("Category id") },
		},
		({ id }) => olx.get(`/categories/${id}/brands`),
	);

	tool(
		server,
		"olx_category_brand_models",
		{
			title: "List brand models",
			description:
				"GET /categories/:id/brands/:brand_id/models: models for a brand within a category.",
			inputSchema: {
				id: z.number().int().describe("Category id"),
				brand_id: z.number().int().describe("Brand id from olx_category_brands"),
			},
		},
		({ id, brand_id }) => olx.get(`/categories/${id}/brands/${brand_id}/models`),
	);

	tool(
		server,
		"olx_suggest_category",
		{
			title: "Suggest a category from a keyword",
			description:
				"GET /categories/suggest?keyword=: suggest categories for free text describing an item. " +
				"The best way to pick a category_id when creating a listing.",
			inputSchema: {
				keyword: z.string().describe("What the item is, e.g. 'iphone 13' or 'zimske gume'"),
			},
		},
		({ keyword }) => olx.get("/categories/suggest", { keyword }),
	);

	tool(
		server,
		"olx_find_category",
		{
			title: "Find a category by name",
			description:
				"GET /categories/find?name=: look up categories by name, returning each match with " +
				"its full path in the tree.",
			inputSchema: { name: z.string().describe("Category name to search for") },
		},
		({ name }) => olx.get("/categories/find", { name }),
	);
};
