const stringify = (value: unknown): string => {
	if (value == null) return "";
	if (Array.isArray(value)) return value.join(" ");
	if (typeof value === "object" && "raw" in value) return String(value.raw);
	return String(value);
};

const $ = new Proxy(Bun.$, {
	apply(target, thisArg, args: Parameters<typeof Bun.$>) {
		const [strings, ...values] = args;
		const cmd = strings
			.map((s, i) => s + (i < values.length ? stringify(values[i]) : ""))
			.join("")
			.trim();
		console.log(`\x1b[2m\x1b[90m$ ${cmd}\x1b[0m`);
		return Reflect.apply(target, thisArg, args);
	},
});

Object.assign(Bun, { $ });
