/**
 * Self-update for installs run through `npx github:omznc/olx-mcp`.
 *
 * npx resolves a git spec once, records the commit in its cache, and reuses that install
 * forever after: re-running the same command never sees a newer commit. So the server checks
 * GitHub itself, and when it is behind it deletes its own npx cache entry. The running process
 * is unaffected (the open file stays alive), and the next launch reinstalls from the new commit.
 *
 * Everything here is best effort. A failed check, no network, or an install that did not come
 * from npx must never stop the server from starting.
 */
import { readFile, rm } from "node:fs/promises";
import { dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "omznc/olx-mcp";
const BRANCH = "main";
const TIMEOUT_MS = 5000;

export type UpdateResult =
	| { state: "disabled" | "not-managed" | "current" | "unknown" | "failed"; message: string }
	| { state: "staged"; message: string; from: string; to: string };

/**
 * The npx cache entry this build runs from, e.g. ~/.npm/_npx/<hash>.
 * Null when running from source, a global install, or a plain clone.
 */
function npxRoot(): string | null {
	// import.meta.url, not process.argv[1]: npx runs the symlink in node_modules/.bin, so argv
	// points at a path that says nothing about where the package actually lives.
	const self = fileURLToPath(import.meta.url);
	const marker = `${sep}node_modules${sep}olx-mcp${sep}`;
	const index = self.indexOf(marker);
	if (index === -1) return null;
	const root = self.slice(0, index);
	return dirname(root).endsWith(`${sep}_npx`) ? root : null;
}

/** The commit npx installed, from the lockfile it wrote next to node_modules. */
async function installedCommit(root: string): Promise<string | null> {
	try {
		const lock = JSON.parse(await readFile(`${root}/package-lock.json`, "utf8"));
		const resolved = lock?.packages?.["node_modules/olx-mcp"]?.resolved;
		if (typeof resolved !== "string") return null;
		const sha = resolved.split("#")[1];
		return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

async function latestCommit(): Promise<string | null> {
	try {
		const response = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
			// Returns the bare sha as text instead of the full commit object.
			headers: { Accept: "application/vnd.github.sha" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const sha = (await response.text()).trim();
		return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

const short = (sha: string) => sha.slice(0, 7);

/**
 * Compares the installed commit against the branch head and, when behind, clears the npx
 * cache so the next launch reinstalls. Set OLX_MCP_NO_AUTO_UPDATE=1 to skip the check.
 */
export async function autoUpdate(): Promise<UpdateResult> {
	if (process.env.OLX_MCP_NO_AUTO_UPDATE)
		return { state: "disabled", message: "Update check disabled by OLX_MCP_NO_AUTO_UPDATE." };

	const root = npxRoot();
	if (!root)
		return {
			state: "not-managed",
			message: "Not running from an npx install, so there is nothing to update automatically.",
		};

	const installed = await installedCommit(root);
	if (!installed)
		return { state: "unknown", message: "Could not tell which commit this install came from." };

	const latest = await latestCommit();
	if (!latest)
		return { state: "unknown", message: "Could not reach GitHub to check for a newer version." };

	if (installed === latest)
		return { state: "current", message: `Up to date (${short(installed)}).` };

	try {
		await rm(root, { recursive: true, force: true });
	} catch {
		return {
			state: "failed",
			message:
				`Version ${short(latest)} is available but the npx cache could not be cleared. ` +
				`Remove ${root} by hand, then restart.`,
		};
	}

	return {
		state: "staged",
		from: installed,
		to: latest,
		message:
			`Update downloaded: ${short(installed)} -> ${short(latest)}. ` +
			"Restart the MCP client to run it.",
	};
}
