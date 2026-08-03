/**
 * Persistent token storage.
 *
 * The token lives in a per-user config file so `login` has to happen only once, rather than
 * in the MCP host's own config (which would put secrets in shell history, and only works for
 * one specific host). Locations follow the same convention as `gh`:
 *
 *   Windows: %APPDATA%\olx-mcp\auth.json
 *   others:  $XDG_CONFIG_HOME/olx-mcp/auth.json, else ~/.config/olx-mcp/auth.json
 */
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface StoredAuth {
	token: string;
	username?: string;
	saved_at: string;
}

const isWindows = platform() === "win32";

export function configDir(): string {
	if (process.env.OLX_MCP_CONFIG_DIR) return process.env.OLX_MCP_CONFIG_DIR;
	if (isWindows)
		return join(
			process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
			"olx-mcp",
		);
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "olx-mcp");
}

export function authFilePath(): string {
	return join(configDir(), "auth.json");
}

export async function readAuth(): Promise<StoredAuth | null> {
	try {
		const parsed = JSON.parse(await readFile(authFilePath(), "utf8")) as StoredAuth;
		return parsed?.token ? parsed : null;
	} catch {
		// Missing, unreadable, or corrupt. Treat all of them as "not logged in".
		return null;
	}
}

export async function writeAuth(auth: StoredAuth): Promise<string> {
	const path = authFilePath();
	await mkdir(dirname(path), { recursive: true, mode: isWindows ? undefined : 0o700 });
	await writeFile(path, `${JSON.stringify(auth, null, 2)}\n`, {
		encoding: "utf8",
		mode: isWindows ? undefined : 0o600,
	});
	// writeFile's mode only applies on create, so enforce it on overwrite too.
	// Windows has no POSIX permission bits; NTFS inherits ACLs from the user profile.
	if (!isWindows) await chmod(path, 0o600);
	return path;
}

export async function clearAuth(): Promise<boolean> {
	try {
		await unlink(authFilePath());
		return true;
	} catch {
		return false;
	}
}
