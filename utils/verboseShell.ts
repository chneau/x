/**
 * Shared `$` used by every command: it echoes each command before running it.
 *
 * Import `$` from here instead of from "bun" — the echo lives in this module
 * rather than a global `Bun.$` patch, so it cannot be silently lost by import
 * order. Interpolate `new Redacted(value)` to keep a value out of the echo
 * while still passing it through to the command.
 */
export class Redacted {
	constructor(readonly value: string) {}
	toString() {
		return this.value;
	}
}

const stringify = (value: unknown): string => {
	if (value == null) return "";
	if (value instanceof Redacted) return "***";
	if (Array.isArray(value)) return value.map(stringify).join(" ");
	if (typeof value === "object" && "raw" in value) return String(value.raw);
	if (typeof value !== "string" && typeof value !== "number") return "***";
	return String(value);
};

export const $ = new Proxy(Bun.$, {
	apply(target, thisArg, args: Parameters<typeof Bun.$>) {
		const [strings, ...values] = args;
		const cmd = Array.isArray(strings)
			? strings
					.map((s, i) => s + (i < values.length ? stringify(values[i]) : ""))
					.join("")
					.trim()
			: String(strings ?? "").trim();
		console.log(`\x1b[2m\x1b[90m$ ${cmd}\x1b[0m`);
		return Reflect.apply(
			target,
			thisArg,
			Array.isArray(strings)
				? [strings, ...values.map((v) => (v instanceof Redacted ? v.value : v))]
				: args,
		);
	},
});
