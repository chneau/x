import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import Cloudflare, { APIError } from "cloudflare";
import { die } from "./helpers";

/**
 * Cloudflare mini-CLI powering the `x cf` command.
 *
 * Uses the official `cloudflare` SDK directly (no external `cf` / `wrangler`
 * binaries required). Credentials are stored in `~/.config/x/cf.json`.
 *
 * Two Cloudflare auth schemes are auto-guessed on `x cf login`:
 *   - API Token                -> one random token per pasted line
 *   - Global API Key (+ email) -> an <email> line paired with an api-key line
 */

const CONFIG_DIR = join(homedir(), ".config", "x");
const CONFIG_FILE = join(CONFIG_DIR, "cf.json");

// ---------------------------------------------------------------------------
// credential store (~/.config/x/cf.json)
// ---------------------------------------------------------------------------

type StoredLogin =
	| {
			id: string;
			kind: "token";
			apiToken: string;
			verifiedEmail?: string;
			createdAt: string;
	  }
	| {
			id: string;
			kind: "apiKey";
			apiEmail: string;
			apiKey: string;
			verifiedEmail?: string;
			createdAt: string;
	  };

interface CfStore {
	activeId?: string;
	logins: StoredLogin[];
}

const readStore = async (): Promise<CfStore> => {
	try {
		const parsed = JSON.parse(
			await readFile(CONFIG_FILE, "utf8"),
		) as Partial<CfStore>;
		return {
			activeId: parsed.activeId,
			logins: Array.isArray(parsed.logins)
				? (parsed.logins as StoredLogin[])
				: [],
		};
	} catch {
		return { logins: [] };
	}
};

const writeStore = async (store: CfStore) => {
	await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
	await writeFile(CONFIG_FILE, `${JSON.stringify(store, null, 2)}\n`, {
		mode: 0o600,
	});
};

const isEmail = (line: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line);

const masked = (value: string) =>
	value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "********";

const makeClient = (login: StoredLogin): Cloudflare =>
	login.kind === "token"
		? new Cloudflare({ apiToken: login.apiToken })
		: new Cloudflare({ apiKey: login.apiKey, apiEmail: login.apiEmail });

/** Resolve the active login (most recent unless overridden) and build a client. */
const loggedInClient = async (): Promise<{
	client: Cloudflare;
	login: StoredLogin;
}> => {
	const store = await readStore();
	if (store.logins.length === 0) {
		die(
			"❌ No Cloudflare login found. Run `x cf login` first (paste an API token\n   or an <email> + <global api key> pair).",
		);
	}
	const active =
		(store.activeId && store.logins.find((l) => l.id === store.activeId)) ??
		store.logins.at(-1);
	if (!active) {
		die("❌ Active Cloudflare login no longer exists. Run `x cf login`.");
	}
	return { client: makeClient(active), login: active };
};

const describeLogin = (login: StoredLogin): string =>
	login.kind === "token"
		? `api-token ${masked(login.apiToken)}`
		: `global key (${login.apiEmail}) ${masked(login.apiKey)}`;

// ---------------------------------------------------------------------------
// x cf login
// ---------------------------------------------------------------------------

/** Collect all non-empty trimmed input lines. */
const linesOf = (raw: string): string[] =>
	raw
		.replace(/^\s+|\s+$/g, "")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

/**
 * Auto-guess credentials from pasted stdin.
 *
 * A login is either a bare API Token (one per line) or a Global API Key that
 * must be accompanied by its account email. When an email is present, every
 * non-email line is treated as a key: a single email applies to all pasted keys
 * (e.g. key rotation), otherwise emails and keys are paired line-by-line.
 */
const parseCredentials = (raw: string): CredInput[] => {
	const lines = linesOf(raw);
	if (lines.length === 0) {
		die("❌ No credentials provided. Paste the API keys into stdin.");
	}

	const emails = lines.filter(isEmail);
	const keys = lines.filter((l) => !isEmail(l));

	if (emails.length > 0) {
		if (keys.length === 0) {
			die("❌ Found an email but no matching API key.");
		}
		if (emails.length === 1) {
			// a single email with one or many global keys for that account
			const email = emails[0];
			if (!email) {
				die("❌ Missing email.");
			}
			return keys.map((apiKey) => ({
				kind: "apiKey" as const,
				apiKey,
				apiEmail: email,
				label: `${email} / ${masked(apiKey)}`,
			}));
		}
		// multiple emails: pair each email with its api key, line by line
		return emails.map((apiEmail, i) => {
			const apiKey = keys[i];
			if (!apiKey) {
				die(`❌ Missing global API key for email ${apiEmail}.`);
			}
			return {
				kind: "apiKey" as const,
				apiKey,
				apiEmail,
				label: `${apiEmail} / ${masked(apiKey)}`,
			};
		});
	}

	// No email -> each line is an API token.
	return keys.map((apiToken) => ({
		kind: "token" as const,
		apiToken,
		label: masked(apiToken),
	}));
};

type CredInput =
	| { kind: "apiKey"; apiKey: string; apiEmail: string; label: string }
	| { kind: "token"; apiToken: string; label: string };

const materializeLogin = (input: CredInput): StoredLogin => {
	const createdAt = new Date().toISOString();
	const rand = () => Math.random().toString(36).slice(2, 10);
	return input.kind === "token"
		? { id: `t-${rand()}`, kind: "token", apiToken: input.apiToken, createdAt }
		: {
				id: `k-${rand()}`,
				kind: "apiKey",
				apiKey: input.apiKey,
				apiEmail: input.apiEmail,
				createdAt,
			};
};

/** Persist credentials, best-effort verify each, then point active login at the newest. */
const saveInputs = async (inputs: CredInput[]) => {
	if (inputs.length === 0) return;
	const store = await readStore();
	for (const input of inputs) {
		const login = materializeLogin(input);
		store.logins = store.logins.filter((l) => l.id !== login.id);
		store.logins.push(login);

		let verified = "";
		try {
			const user = await makeClient(login).user.get();
			if (user.email) {
				login.verifiedEmail = user.email;
				verified = ` (verified: ${user.email})`;
			}
		} catch {
			// not every token may read /user; it is still saved for the zone calls
		}
		console.log(`✅ Saved Cloudflare credentials: ${input.label}${verified}`);
	}

	store.activeId = store.logins.at(-1)?.id;
	await writeStore(store);
	console.log(`\nStored in ${CONFIG_FILE}. The newest login is now active.`);
	console.log(`Try: x cf domains list   |   x cf mailforwarding list`);
};

// ---------------------------------------------------------------------------
// interactive prompt helpers (only used when stdin is an interactive TTY)
// ---------------------------------------------------------------------------

const askQuestion = async (
	rl: ReturnType<typeof createInterface>,
	query: string,
) => {
	const answer = await rl.question(query);
	return answer.trim();
};

/**
 * Interactive login: because pasting into a silent prompt is confusing, walk the
 * user through what kind of credential Cloudflare accepts, then read it.
 */
const interactiveLogin = async () => {
	console.log(
		"\nCloudflare login accepts either of these (from " +
			"https://dash.cloudflare.com/profile/api-tokens):",
	);
	console.log(" • an API Token      — a single random string");
	console.log(
		" • a Global API Key  — used together with your Cloudflare account email",
	);
	console.log();

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	const chooseScheme = async (): Promise<"apiToken" | "globalKey" | null> => {
		const first = await askQuestion(
			rl,
			"What would you like to use? (1: API Token, 2: Global API Key, or blank / q to quit) ",
		);
		const key = first.toLowerCase();
		if (key === "" || key === "q" || key === "quit") return null;
		if (key === "1" || key === "token" || key === "t") return "apiToken";
		if (key === "2" || key === "global" || key === "key" || key === "g") {
			return "globalKey";
		}
		console.log("  (please answer 1 or 2)");
		return chooseScheme();
	};

	const scheme = await chooseScheme();
	if (!scheme) {
		rl.close();
		console.log("Nothing saved.");
		return;
	}

	const inputs: CredInput[] = [];
	rl.setPrompt("");

	if (scheme === "apiToken") {
		// Keep reading tokens until the user leaves a line blank.
		for (;;) {
			const token = await askQuestion(
				rl,
				"\nPaste your API Token (or leave blank / 'q' to finish): ",
			);
			if (!token || token.toLowerCase() === "q") break;
			inputs.push({
				kind: "token",
				apiToken: token,
				label: `api-token ${masked(token)}`,
			});
		}
	} else {
		const email = await askQuestion(
			rl,
			"\nYour Cloudflare account email (e.g. you@example.com): ",
		);
		if (!email) {
			rl.close();
			console.log("No email provided — nothing saved.");
			return;
		}
		// Global keys for one email: keep reading until blank.
		for (;;) {
			const key = await askQuestion(
				rl,
				`\nPaste a Global API Key for ${email} (blank / 'q' to finish): `,
			);
			if (!key || key.toLowerCase() === "q") break;
			inputs.push({
				kind: "apiKey",
				apiKey: key,
				apiEmail: email,
				label: `${email} / ${masked(key)}`,
			});
		}
	}

	rl.close();

	if (inputs.length === 0) {
		console.log("Nothing was entered — no credentials saved.");
		return;
	}
	await saveInputs(inputs);
};

export const commandCfLogin = async () => {
	// Interactive terminal -> guide the user through what to enter.
	if (process.stdin.isTTY) {
		await interactiveLogin();
		return;
	}

	// Piped stdin (e.g. `printf "token\n" | x cf login`) -> auto-guess line by line.
	const raw = await new Promise<string>((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.resume();
	});

	const inputs = parseCredentials(raw);
	if (inputs.length === 0) return;
	await saveInputs(inputs);
};

export const commandCfLoginList = async () => {
	const store = await readStore();
	if (store.logins.length === 0) {
		console.log("No Cloudflare logins saved yet. Run `x cf login`.");
		return;
	}
	const activeId = store.activeId ?? store.logins.at(-1)?.id;
	for (const l of store.logins) {
		const note = l.verifiedEmail ? ` (${l.verifiedEmail})` : "";
		console.log(
			`${l.id === activeId ? "▶" : " "} ${l.id}  ${describeLogin(l)}${note}`,
		);
	}
	console.log(`\nActive login: ${activeId}`);
};

export const commandCfLoginUse = async (id: string) => {
	const store = await readStore();
	const found = store.logins.find((l) => l.id === id);
	if (!found) {
		die(`❌ No login with id '${id}'. See \`x cf login list\`.`);
	}
	store.activeId = id;
	await writeStore(store);
	console.log(`✅ Active login is now ${id} (${describeLogin(found)}).`);
};

export const commandCfLoginRemove = async (id: string) => {
	const store = await readStore();
	const before = store.logins.length;
	store.logins = store.logins.filter((l) => l.id !== id);
	if (store.logins.length === before) {
		die(`❌ No login with id '${id}'.`);
	}
	if (store.activeId === id) store.activeId = store.logins.at(-1)?.id;
	await writeStore(store);
	await commandCfLoginList();
};

export const commandCfLogout = async () => {
	const store = await readStore();
	store.activeId = undefined;
	await writeStore(store);
	console.log("✅ Cleared the active login credentials reference.");
};

// ---------------------------------------------------------------------------
// zone helpers
// ---------------------------------------------------------------------------

const listZones = async (client: Cloudflare) => {
	const out: Array<{ id: string; name: string }> = [];
	for await (const zone of client.zones.list()) {
		out.push({ id: zone.id, name: zone.name ?? zone.id });
	}
	return out;
};

const findZone = async (client: Cloudflare, wanted: string) => {
	const target = wanted.toLowerCase().replace(/^\./, "");
	for await (const zone of client.zones.list()) {
		if ((zone.name ?? "").toLowerCase() === target) {
			return { id: zone.id, name: zone.name ?? zone.id };
		}
	}
	return null;
};

type CatchAllRule = {
	id?: string;
	enabled?: boolean;
	name?: string;
	matchers?: { type: "all" }[];
	actions?: { type: "drop" | "forward" | "worker"; value?: string[] }[];
};

const getCatchAll = async (
	client: Cloudflare,
	zoneId: string,
): Promise<CatchAllRule | null> => {
	try {
		const rule = await client.emailRouting.rules.catchAlls.get({
			zone_id: zoneId,
		});
		return rule as CatchAllRule;
	} catch (err) {
		if (err instanceof APIError) return null; // catch-all not configured / no routing
		throw err;
	}
};

// ---------------------------------------------------------------------------
// x cf domains list
// ---------------------------------------------------------------------------

export const commandCfDomainsList = async () => {
	const { client, login } = await loggedInClient();
	const zonesFound = await listZones(client);
	console.log(
		`${zonesFound.length} domain${zonesFound.length === 1 ? "" : "s"} on ${
			login.verifiedEmail ?? describeLogin(login)
		}:`,
	);
	for (const z of zonesFound) console.log(` • ${z.name}`);
};

// ---------------------------------------------------------------------------
// x cf mailforwarding
// ---------------------------------------------------------------------------

const forwardDestination = (rule: CatchAllRule | null): string | null => {
	if (!rule?.enabled) return null;
	const forwardActions =
		rule.actions?.filter(
			(a) => a.type === "forward" && Array.isArray(a.value),
		) ?? [];
	const targets = forwardActions
		.flatMap((a) => a.value ?? [])
		.filter(
			(dest): dest is string => typeof dest === "string" && dest.length > 0,
		);
	return targets.length > 0 ? targets.join(", ") : null;
};

export const commandCfMailforwardingList = async () => {
	const { client } = await loggedInClient();
	const zonesFound = await listZones(client);
	if (zonesFound.length === 0) {
		console.log("No domains found for the logged-in account.");
		return;
	}

	const rows = await Promise.all(
		zonesFound.map(async (zone) => {
			const rule = await getCatchAll(client, zone.id);
			return { name: zone.name, dest: forwardDestination(rule) };
		}),
	);

	const width = Math.max(6, ...rows.map((r) => r.name.length)) + 2; // "DOMAIN"
	const line = "-".repeat(width + 22);
	console.log();
	console.log(`${"DOMAIN".padEnd(width)}DESTINATION`);
	console.log(line);
	for (const r of rows) {
		console.log(`${r.name.padEnd(width)}-> ${r.dest ?? "(none)"}`);
	}
	console.log(line);
	console.log();
};

/** Ensure the zone's Email Routing product is switched on before touching its rule. */
const ensureEmailRoutingOn = async (client: Cloudflare, zoneId: string) => {
	let enabled = false;
	try {
		const settings = await client.emailRouting.get({ zone_id: zoneId });
		enabled = settings.enabled === true;
	} catch {
		// reading settings failed -> try to enable anyway
	}
	if (enabled) return;
	try {
		await client.emailRouting.enable({ zone_id: zoneId, body: {} });
	} catch (err) {
		die(
			"❌ Could not enable Email Routing on this domain.",
			err instanceof Error ? err.message : undefined,
		);
	}
};

export const commandCfMailforwardingSet = async (
	domain: string,
	destination?: string,
) => {
	const { client } = await loggedInClient();
	const zone = await findZone(client, domain);
	if (!zone) {
		die(`❌ Domain '${domain}' not found in the logged-in account.`);
	}

	if (!destination) {
		// unset: disable the catch-all, keeping whatever matcher/actions existed
		const current = await getCatchAll(client, zone.id);
		const base = {
			zone_id: zone.id,
			enabled: false as const,
			matchers: current?.matchers?.length
				? current.matchers
				: [{ type: "all" as const }],
			source: "api" as const,
		};
		try {
			await client.emailRouting.rules.catchAlls.update({
				...base,
				actions: current?.actions ?? [{ type: "forward", value: [] }],
			});
			console.log(
				`✅ Unset mail forwarding for ${zone.name} (catch-all disabled).`,
			);
		} catch (err) {
			die(
				`❌ Could not unset mail forwarding for ${zone.name}.`,
				err instanceof Error ? err.message : undefined,
			);
		}
		return;
	}

	// ensure routing product is on, then point the catch-all at the destination
	try {
		await ensureEmailRoutingOn(client, zone.id);
		await client.emailRouting.rules.catchAlls.update({
			zone_id: zone.id,
			enabled: true,
			name: "Catch-all",
			matchers: [{ type: "all" }],
			actions: [{ type: "forward", value: [destination] }],
			source: "api",
		});
		console.log(`✅ Mail forward set: ${zone.name} -> ${destination}`);
	} catch (err) {
		die(
			`❌ Could not set mail forwarding for ${zone.name}.\n` +
				"   Ensure the destination address is verified for Email Routing.",
			err instanceof Error ? err.message : undefined,
		);
	}
};
