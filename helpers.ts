import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

export function die(message: string, detail?: string): never {
	console.error(message);
	if (detail) console.error(`   ${detail}`);
	process.exit(1);
}

export const commandExists = async (cmd: string) => {
	const shell =
		process.platform === "win32"
			? $`powershell.exe -Command "Get-Command ${cmd}"`
			: $`which ${cmd}`;
	return (await shell.quiet().nothrow()).exitCode === 0;
};

export const isRoot = async () => (await $`id -u`.text()).trim() === "0";

export const canSudo = async () =>
	(await $`sudo -n true`.quiet().nothrow()).exitCode === 0;

export const getCurrentVersion = async () =>
	await Bun.file(`${import.meta.dir}/package.json`)
		.json()
		.then((x) => (x.version as string) ?? "0.0.0")
		.catch(() => "0.0.0");

export const fetchLatestVersion = async () =>
	await fetch("https://registry.npmjs.org/@chneau/x/latest")
		.then((x) => x.json())
		.then((x) => x.version as string)
		.catch(() => "0.0.0");

export const envSubst = (str: string) =>
	str.replace(/\${(.*?)}/g, (_, key) => Bun.env[key] ?? "");

export const formatBytes = (bytes: number): string => {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	const decimals = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(decimals)} ${units[unit] ?? "B"}`;
};

/** Runs `fn` over `items` with at most `concurrency` promises in flight at once. */
export const mapConcurrent = async <T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> => {
	const results: R[] = [];
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			const item = items[index];
			if (item === undefined) continue;
			results[index] = await fn(item);
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(Math.max(concurrency, 1), items.length) },
			() => worker(),
		),
	);
	return results;
};

/** Immediate child directories, skipping hidden dirs and node_modules. */
export const subdirectories = async (path: string): Promise<string[]> =>
	(await readdir(path, { withFileTypes: true }).catch(() => []))
		.filter((x) => x.isDirectory())
		.filter((x) => !x.name.startsWith("."))
		.filter((x) => !x.name.includes("node_modules"))
		.map((x) => join(path, x.name));

/** Breadth-first list of `root` plus its subdirectories up to `levels` deep. */
export const walkDirectories = async (
	root: string,
	levels: number,
): Promise<string[]> => {
	const result = [root];
	if (levels <= 0) return result;
	let current = [root];
	for (let level = 0; level < levels; level++) {
		const next = (
			await Promise.all(current.map((dir) => subdirectories(dir)))
		).flat();
		if (next.length === 0) break;
		result.push(...next);
		current = next;
	}
	return result;
};
