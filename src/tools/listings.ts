import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import type { Registrar } from "./helpers.ts";
import { tool } from "./helpers.ts";
import { compactListing, fullFlag } from "./shape.ts";

const attribute = z.object({
	id: z.number().describe("Attribute id, from olx_category_attributes"),
	value: z
		.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
		.describe("Attribute value, matching the attribute's input_type"),
});

export const registerListingTools: Registrar = (server, olx) => {
	tool(
		server,
		"olx_get_listing",
		{
			title: "Get a listing",
			description:
				"GET /listings/:id: fetch a single listing by its numeric id. Returns a summary of " +
				"the listing; pass full=true for the complete OLX record.",
			inputSchema: { id: z.number().int().describe("Listing id"), full: fullFlag },
		},
		async ({ id, full }) => {
			const payload = await olx.get(`/listings/${id}`);
			return full ? payload : compactListing(payload);
		},
	);

	tool(
		server,
		"olx_create_listing",
		{
			title: "Create a listing",
			description:
				"POST /listings: create a new listing. It starts in DRAFT status, but do not treat " +
				"that as private: OLX publishes the listing on the first olx_update_listing call, " +
				"without olx_publish_listing. Only create a listing the user is happy to have go " +
				"public, and get the content right in this call rather than fixing it up afterwards. " +
				"Look up category attributes with olx_category_attributes first, since required " +
				"attributes vary per category.",
			inputSchema: {
				title: z.string().describe("Listing title (required)"),
				short_description: z.string().optional(),
				description: z.string().optional(),
				category_id: z.number().int().optional().describe("Category id from olx_categories"),
				country_id: z.union([z.string(), z.number()]).optional(),
				city_id: z.union([z.string(), z.number()]).optional(),
				price: z.number().optional().describe("Price in KM"),
				available: z.boolean().optional(),
				listing_type: z.enum(["sell", "buy", "rent"]).optional(),
				state: z.enum(["new", "used"]).optional().describe("Condition of the item"),
				brand_id: z.union([z.string(), z.number()]).optional(),
				model_id: z.union([z.string(), z.number()]).optional(),
				sku_number: z.string().optional(),
				attributes: z
					.array(attribute)
					.optional()
					.describe("Category-specific attributes as {id, value} pairs"),
			},
		},
		async (args) => compactListing(await olx.post("/listings", args)),
	);

	tool(
		server,
		"olx_update_listing",
		{
			title: "Update a listing",
			description:
				"PUT /listings/:id: update fields on an existing listing. Only the fields you pass " +
				"are changed. Warning: on a DRAFT listing this also publishes it and the listing " +
				"becomes publicly visible on OLX, the same as olx_publish_listing. Confirm with the " +
				"user before updating a draft they have not agreed to publish.",
			inputSchema: {
				id: z.number().int().describe("Listing id"),
				title: z.string().optional(),
				short_description: z.string().optional(),
				description: z.string().optional(),
				price: z.number().optional(),
				available: z.boolean().optional(),
				city_id: z.union([z.string(), z.number()]).optional(),
				state: z.enum(["new", "used"]).optional(),
				attributes: z.array(attribute).optional(),
			},
		},
		async ({ id, ...body }) => compactListing(await olx.put(`/listings/${id}`, body)),
	);

	tool(
		server,
		"olx_publish_listing",
		{
			title: "Publish a listing",
			description:
				"POST /listings/:id/publish: move a DRAFT listing to active so it appears publicly " +
				"on OLX. Note that olx_update_listing publishes a draft too, so this is not the only " +
				"way a listing goes public.",
			inputSchema: { id: z.number().int().describe("Listing id") },
		},
		({ id }) => olx.post(`/listings/${id}/publish`),
	);

	tool(
		server,
		"olx_delete_listing",
		{
			title: "Delete a listing",
			description:
				"DELETE /listings/:id: permanently delete a listing. This cannot be undone; " +
				"prefer olx_hide_listing or olx_finish_listing if you may want it back.",
			inputSchema: { id: z.number().int().describe("Listing id") },
		},
		({ id }) => olx.delete(`/listings/${id}`),
	);

	tool(
		server,
		"olx_finish_listing",
		{
			title: "Finish a listing",
			description:
				"POST /listings/:id/finish: mark a listing as finished/sold. It stops being active " +
				"but stays in the account's finished listings.",
			inputSchema: { id: z.number().int().describe("Listing id") },
		},
		({ id }) => olx.post(`/listings/${id}/finish`),
	);

	tool(
		server,
		"olx_hide_listing",
		{
			title: "Hide a listing",
			description: "POST /listings/:id/hide: temporarily hide an active listing from public view.",
			inputSchema: { id: z.number().int().describe("Listing id") },
		},
		({ id }) => olx.post(`/listings/${id}/hide`),
	);

	tool(
		server,
		"olx_unhide_listing",
		{
			title: "Unhide a listing",
			description: "POST /listings/:id/unhide: make a previously hidden listing visible again.",
			inputSchema: { id: z.number().int().describe("Listing id") },
		},
		({ id }) => olx.post(`/listings/${id}/unhide`),
	);

	tool(
		server,
		"olx_refresh_listing",
		{
			title: "Refresh a listing",
			description:
				"PUT /listings/:id/refresh: bump a listing back to the top of search results. " +
				"Refreshes beyond the free allowance are charged; check olx_refresh_limits first.",
			inputSchema: { id: z.number().int().describe("Listing id") },
		},
		({ id }) => olx.put(`/listings/${id}/refresh`),
	);

	tool(
		server,
		"olx_refresh_limits",
		{
			title: "Get refresh limits",
			description:
				"GET /listing/refresh/limits: how many free and paid refreshes the account has used " +
				"and has left ({free_limit, free_count, paid_count, listing_count}).",
		},
		() => olx.get("/listing/refresh/limits"),
	);

	tool(
		server,
		"olx_listing_limits",
		{
			title: "Get listing limits",
			description:
				"GET /listing-limits: per-segment listing quotas (cars, real-estate, other) with the " +
				"limit and current listing count for each.",
		},
		() => olx.get("/listing-limits"),
	);

	tool(
		server,
		"olx_upload_listing_images",
		{
			title: "Upload listing images",
			description:
				"POST /listings/:id/image-upload: attach images to a listing. Provide local file " +
				"paths, remote image URLs, or both. Local files are read from disk and sent as " +
				"multipart form data; remote URLs are downloaded first and uploaded the same way.",
			inputSchema: {
				id: z.number().int().describe("Listing id"),
				file_paths: z
					.array(z.string())
					.optional()
					.describe("Absolute paths to image files on this machine"),
				image_urls: z
					.array(z.url())
					.optional()
					.describe("Public URLs of images to fetch and upload"),
			},
		},
		async ({ id, file_paths = [], image_urls = [] }) => {
			if (file_paths.length === 0 && image_urls.length === 0)
				throw new Error("Provide at least one of file_paths or image_urls.");

			const form = new FormData();
			for (const path of file_paths) {
				let bytes: Buffer;
				try {
					bytes = await readFile(path);
				} catch {
					throw new Error(`Could not read file: ${path}`);
				}
				form.append("images[]", new Blob([bytes]), basename(path));
			}
			for (const url of image_urls) {
				const response = await fetch(url);
				if (!response.ok)
					throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
				const blob = await response.blob();
				const name = new URL(url).pathname.split("/").pop() || "image";
				form.append("images[]", blob, name);
			}

			return olx.request("POST", `/listings/${id}/image-upload`, { formData: form });
		},
	);

	tool(
		server,
		"olx_delete_listing_image",
		{
			title: "Delete a listing image",
			description: "POST /listings/:id/image-delete: remove one image from a listing.",
			inputSchema: {
				id: z.number().int().describe("Listing id"),
				imageId: z.number().int().describe("Image id, as returned by the upload response"),
			},
		},
		({ id, imageId }) => olx.post(`/listings/${id}/image-delete`, { imageId }),
	);

	tool(
		server,
		"olx_set_main_listing_image",
		{
			title: "Set the main listing image",
			description:
				"POST /listings/:id/image-main: choose which uploaded image is the listing's cover photo.",
			inputSchema: {
				id: z.number().int().describe("Listing id"),
				imageId: z.number().int().describe("Image id to promote to main"),
			},
		},
		({ id, imageId }) => olx.post(`/listings/${id}/image-main`, { imageId }),
	);
};
