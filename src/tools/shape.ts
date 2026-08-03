import { z } from "zod";

/**
 * OLX responses are far larger than the fields these tools advertise: /me is
 * mostly notification settings and medals, /cities returns every city in the
 * country as a nested tree, and every listing card embeds its whole category
 * object. All of it lands in the caller's context window, so the noisiest tools
 * summarise by default and take `full: true` when the raw record is wanted.
 */

export const fullFlag = z
	.boolean()
	.optional()
	.describe(
		"Return the raw OLX response instead of the summary. Much larger, so only use it if a " +
			"field you need is missing from the summary.",
	);

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Most endpoints wrap their payload in `data`; a few return it bare. */
function unwrap(payload: unknown): unknown {
	return isDict(payload) && "data" in payload ? payload.data : payload;
}

function pick(source: Dict, keys: readonly string[]): Dict {
	const out: Dict = {};
	for (const key of keys) {
		const value = source[key];
		if (value !== undefined && value !== null) out[key] = value;
	}
	return out;
}

/** Keep pagination so callers can still tell there are more pages. */
function withMeta(payload: unknown, data: unknown): Dict {
	const out: Dict = { data };
	if (isDict(payload) && isDict(payload.meta))
		out.meta = pick(payload.meta, ["total", "current_page", "last_page", "per_page"]);
	return out;
}

const USER_KEYS = [
	"id",
	"username",
	"first_name",
	"last_name",
	"email",
	"phone",
	"credits",
	"banned",
	"email_verified",
	"phone_verified",
	"delivery_enabled",
	"created_at",
] as const;

export function compactMe(payload: unknown): unknown {
	const user = unwrap(payload);
	if (!isDict(user)) return payload;
	const out = pick(user, USER_KEYS);
	if (isDict(user.location)) out.location = pick(user.location, ["id", "name", "canton_id"]);
	if (isDict(user.feedbacks)) out.feedbacks = user.feedbacks;
	return Object.keys(out).length > 0 ? out : payload;
}

const CARD_KEYS = [
	"id",
	"title",
	"price",
	"display_price",
	"show_price",
	"listing_type",
	"state",
	"status",
	"available",
	"visible",
	"sponsored",
	"category_id",
	"city_id",
	"user_id",
	"image",
	"date",
] as const;

function compactCard(item: unknown): unknown {
	if (!isDict(item)) return item;
	const out = pick(item, CARD_KEYS);
	if (isDict(item.category)) out.category = pick(item.category, ["id", "name"]);
	return out;
}

/** Search results and the per-state user listing endpoints share a card shape. */
export function compactListingList(payload: unknown): unknown {
	const data = unwrap(payload);
	if (!Array.isArray(data)) return payload;
	return withMeta(payload, data.map(compactCard));
}

const LISTING_KEYS = [
	"id",
	"title",
	"slug",
	"price",
	"display_price",
	"show_price",
	"listing_type",
	"state",
	"status",
	"available",
	"visible",
	"quantity",
	"views",
	"category_id",
	"brand",
	"model",
	"sku_number",
	"shipping",
	"sponsored",
	"date",
	"created_at",
] as const;

export function compactListing(payload: unknown): unknown {
	const listing = unwrap(payload);
	if (!isDict(listing)) return payload;
	const out = pick(listing, LISTING_KEYS);
	if (isDict(listing.additional) && listing.additional.description !== undefined)
		out.description = listing.additional.description;
	if (Array.isArray(listing.attributes))
		out.attributes = listing.attributes.map((item) =>
			isDict(item) ? pick(item, ["id", "name", "value"]) : item,
		);
	if (Array.isArray(listing.images)) out.images = listing.images;
	if (isDict(listing.category)) out.category = pick(listing.category, ["id", "name"]);
	if (Array.isArray(listing.cities))
		out.cities = listing.cities.map((item) =>
			isDict(item) ? pick(item, ["id", "name"]) : item,
		);
	if (isDict(listing.user)) out.user = pick(listing.user, ["id", "username"]);
	// Nothing recognisable: an error body or a changed shape. Don't swallow it.
	return Object.keys(out).length > 0 ? out : payload;
}

const CATEGORY_KEYS = [
	"id",
	"name",
	"slug",
	"parent_id",
	"top_category",
	"show_price",
	"show_brand",
	"brand_required",
	"model_required",
	"has_models",
	"show_condition",
	"shipping_available",
	"listing_fee",
	"base_listing_price",
] as const;

export function compactCategories(payload: unknown): unknown {
	const data = unwrap(payload);
	if (!Array.isArray(data)) return payload;
	return { data: data.map((item) => (isDict(item) ? pick(item, CATEGORY_KEYS) : item)) };
}

const ATTRIBUTE_KEYS = [
	"id",
	"display_name",
	"name",
	"type",
	"input_type",
	"required",
	"options",
] as const;

export function compactAttributes(payload: unknown): unknown {
	const data = unwrap(payload);
	if (!Array.isArray(data)) return payload;
	const out: Dict = {
		data: data.map((item) => (isDict(item) ? pick(item, ATTRIBUTE_KEYS) : item)),
	};
	if (isDict(payload))
		Object.assign(
			out,
			pick(payload, ["show_brand", "show_condition", "show_price", "show_map", "booking_enabled"]),
		);
	return out;
}

/**
 * /cities nests entity -> canton -> city, and each city carries coordinates and a zip code
 * nobody asked for. Keep the grouping (repeating the canton name on every city costs more
 * than the nesting does) and strip each city down to what city_id lookups need.
 */
export function compactCities(payload: unknown): unknown {
	const data = unwrap(payload);
	if (!Array.isArray(data)) return payload;

	const flat: Dict[] = [];
	const states: Dict[] = [];
	for (const state of data) {
		if (!isDict(state)) continue;
		// Already a flat city list, so trim each entry instead of descending.
		if (!Array.isArray(state.cantons)) {
			if (state.id !== undefined) flat.push(pick(state, ["id", "name", "code", "canton_id"]));
			continue;
		}
		const cantons: Dict[] = [];
		for (const canton of state.cantons) {
			if (!isDict(canton) || !Array.isArray(canton.cities)) continue;
			cantons.push({
				id: canton.id,
				name: canton.name,
				cities: canton.cities
					.filter(isDict)
					.map((city) => ({ id: city.id, name: city.name })),
			});
		}
		if (cantons.length > 0) states.push({ state: state.name, cantons });
	}

	if (states.length > 0) return { data: states };
	if (flat.length > 0) return { data: flat };
	// Shape changed on OLX's side. Hand back what we got rather than nothing.
	return payload;
}
