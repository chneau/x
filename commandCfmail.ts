import { $ } from "bun";
import { commandExists } from "./helpers";

type CfResult = {
	ok: boolean;
	data: unknown;
	error: string;
};

type CatchAllRule = {
	enabled?: boolean;
	name?: string;
	matchers?: unknown[];
	actions?: { value?: string[] }[];
};

const stripAnsi = (value: string) => {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping
	return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
};

const assertCf = async () => {
	if (!(await commandExists("cf"))) {
		console.error("❌ 'cf' (Cloudflare CLI) is not installed or not in PATH.");
		process.exit(1);
	}
};

const cfJson = async (...args: string[]): Promise<CfResult> => {
	const res = await $`cf ${args}`.quiet().nothrow();
	const raw = `${res.stdout.toString()}\n${res.stderr.toString()}`;
	const text = stripAnsi(raw).trim();
	if (res.exitCode !== 0 && !text) {
		return {
			ok: false,
			data: null,
			error: `cf exited with code ${res.exitCode}`,
		};
	}
	try {
		const data = JSON.parse(text) as unknown;
		const body = data as { success?: boolean; errors?: { message?: string }[] };
		if (body && typeof body.success === "boolean" && body.success === false) {
			const messages = (body.errors ?? [])
				.map((e) => e.message ?? "unknown error")
				.join("; ");
			return { ok: false, data: null, error: messages || text };
		}
		return { ok: true, data, error: "" };
	} catch {
		return {
			ok: false,
			data: null,
			error: text || `cf exited with code ${res.exitCode}`,
		};
	}
};
const listZoneNames = async (): Promise<string[]> => {
	const res = await cfJson("zones", "list");
	if (!res.ok || !Array.isArray(res.data)) {
		console.error("❌ Could not list Cloudflare zones:", res.error);
		process.exit(1);
	}
	return (res.data as { name?: string }[])
		.map((z) => z.name)
		.filter(
			(name): name is string => typeof name === "string" && name.length > 0,
		);
};

const routingEnabled = async (zone: string): Promise<boolean | null> => {
	const res = await cfJson("email-routing", "get", "-z", zone);
	if (res.ok) {
		const settings = res.data as { enabled?: boolean };
		return typeof settings.enabled === "boolean" ? settings.enabled : null;
	}
	// Fallback: Email Routing is configured when Cloudflare MX records exist.
	const mx = await cfJson("dns", "records", "list", "-z", zone);
	if (mx.ok && Array.isArray(mx.data)) {
		const records = mx.data as { type?: string; content?: string }[];
		const hasCfMx = records.some(
			(r) =>
				r.type === "MX" &&
				(r.content ?? "").toLowerCase().endsWith(".mx.cloudflare.net"),
		);
		return hasCfMx;
	}
	return null;
};

const catchAll = async (zone: string): Promise<CatchAllRule | null> => {
	const res = await cfJson(
		"email-routing",
		"rules",
		"catch-alls",
		"get",
		"-z",
		zone,
	);
	if (!res.ok) {
		return null;
	}
	return res.data as CatchAllRule;
};

const assertCatchallKeyword = (keyword: string) => {
	if (keyword !== "catchall") {
		console.error(
			"❌ Expected the rule keyword 'catchall' but got:",
			`'${keyword}'`,
		);
		process.exit(1);
	}
};

const fmt = (value: string, width: number) => value.padEnd(width, " ");

export const commandCfmailList = async () => {
	await assertCf();
	const zones = await listZoneNames();
	if (zones.length === 0) {
		console.log("No Cloudflare zones found.");
		return;
	}
	console.log();
	console.log(
		`${fmt("DOMAIN", 22)}${fmt("EMAIL ROUTING", 14)}${fmt(
			"CATCH-ALL",
			14,
		)}TARGET`,
	);
	console.log("-".repeat(64));
	for (const zone of zones) {
		const [routing, catchall] = await Promise.all([
			routingEnabled(zone),
			catchAll(zone),
		]);
		const routingLabel =
			routing === null ? "⚠ unknown" : routing ? "on" : "off";
		const catchLabel =
			catchall && catchall.enabled === true
				? "enabled"
				: catchall && catchall.enabled === false
					? "none"
					: "⚠ unknown";
		const target = catchall?.actions?.[0]?.value?.[0] ?? "—";
		console.log(
			`${fmt(zone, 22)}${fmt(routingLabel, 14)}${fmt(catchLabel, 14)}${target}`,
		);
	}
	console.log("-".repeat(64));
	console.log();
};

export const commandCfmailSet = async (
	domain: string,
	keyword: string,
	targetEmail: string,
) => {
	await assertCf();
	assertCatchallKeyword(keyword);
	console.log(`🕒 Enabling Email Routing for ${domain}...`);
	const enable = await cfJson("email-routing", "enable", "-z", domain);
	if (!enable.ok) {
		console.error("❌ Failed to enable Email Routing:", enable.error);
		process.exit(1);
	}
	console.log(`🕒 Setting catch-all to forward to ${targetEmail}...`);
	const body = {
		enabled: true,
		name: "Catch-all",
		matchers: [{ type: "all" }],
		actions: [{ type: "forward", value: [targetEmail] }],
		source: "api",
	};
	const update = await cfJson(
		"email-routing",
		"rules",
		"catch-alls",
		"update",
		"-z",
		domain,
		"--body",
		JSON.stringify(body),
	);
	if (!update.ok) {
		console.error("❌ Failed to set catch-all:", update.error);
		console.error(
			"   Make sure the destination address is verified for Email Routing.",
		);
		process.exit(1);
	}
	console.log(`✅ Catch-all set: ${domain} -> ${targetEmail}`);
};

export const commandCfmailUnset = async (domain: string, keyword: string) => {
	await assertCf();
	assertCatchallKeyword(keyword);
	console.log(`🕒 Disabling catch-all for ${domain}...`);
	const current = await cfJson(
		"email-routing",
		"rules",
		"catch-alls",
		"get",
		"-z",
		domain,
	);
	const rule = (current.ok ? current.data : {}) as CatchAllRule;
	const body: Record<string, unknown> = { enabled: false, source: "api" };
	if (typeof rule.name === "string" && rule.name.length > 0) {
		body.name = rule.name;
	}
	if (Array.isArray(rule.matchers) && rule.matchers.length > 0) {
		body.matchers = rule.matchers;
	}
	if (Array.isArray(rule.actions) && rule.actions.length > 0) {
		body.actions = rule.actions;
	}
	const update = await cfJson(
		"email-routing",
		"rules",
		"catch-alls",
		"update",
		"-z",
		domain,
		"--body",
		JSON.stringify(body),
	);
	if (!update.ok) {
		console.error("❌ Failed to unset catch-all:", update.error);
		process.exit(1);
	}
	console.log(`✅ Catch-all disabled for ${domain}`);
};
