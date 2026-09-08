import { $ } from "bun";
import config from "../config.json";
import { commandExists } from "./helpers";

type PkgType = "apt" | "brew" | "bun" | "custom" | "winget" | "uv" | "dotnet";

export type Pkg = {
	name: string;
	type: PkgType;
	check: () => Promise<boolean>;
	install: () => Promise<unknown>;
};

/** Outcome of installing a batch of packages. */
type InstallResult = {
	label: string;
	/** Packages that install() was invoked for. */
	names: string[];
	/** True when every install attempt succeeded (or there was nothing to do). */
	ok: boolean;
	/** Name -> error message for each failed package. */
	failures: Record<string, string>;
};

/** A package entry from config.json; `check` overrides the binary name tested. */
type ConfigPkg = { name: string; check?: string };

const createPkg = (
	name: string,
	type: PkgType,
	install: () => Promise<unknown>,
	checkName?: string,
): Pkg => ({
	name,
	type,
	check: () => commandExists(checkName ?? name),
	install,
});

/**
 * Install strategy per tool:
 * - `"batch"`: install the whole list in one command.
 * - `"sequential"`: install packages one at a time.
 */
const installers: Record<
	Exclude<PkgType, "custom" | "winget">,
	{
		strategy: "batch" | "sequential";
		label: string;
		run: (names: string | string[]) => Promise<unknown>;
	}
> = {
	apt: {
		strategy: "batch",
		label: "apt",
		run: (names) => $`sudo apt install -y ${names}`,
	},
	brew: {
		strategy: "batch",
		label: "brew",
		run: (names) => $`brew install ${names}`,
	},
	bun: {
		strategy: "batch",
		label: "bun",
		run: (names) => $`bun install --force --global ${names}`,
	},
	uv: {
		strategy: "sequential",
		label: "uv tool",
		run: (names) => $`uv tool install --force ${names}`.nothrow(),
	},
	dotnet: {
		strategy: "sequential",
		label: "dotnet tool",
		run: (names) =>
			$`dotnet tool install --global ${names} || dotnet tool update --global ${names}`.nothrow(),
	},
};

/** Build the `Pkg` list for a config section, e.g. `makePkgs("apt", config.packages.apt)`. */
const makePkgs = (
	type: keyof typeof installers,
	list: readonly (ConfigPkg | string)[],
): Pkg[] =>
	list.map((pkg) => {
		const name = typeof pkg === "string" ? pkg : pkg.name;
		return createPkg(
			name,
			type,
			() => installers[type].run(name),
			typeof pkg === "string" ? undefined : pkg.check,
		);
	});

const aptPkgs = makePkgs("apt", config.packages.apt);

const brewPkgs = makePkgs("brew", config.packages.brew);

export const bunPkgs = makePkgs("bun", config.packages.bun);

const uvPkgs = makePkgs("uv", config.packages.uv ?? []);

const dotnetPkgs = makePkgs("dotnet", config.packages.dotnet ?? []);

const customPkgs: Pkg[] = config.packages.custom.map((pkg) =>
	createPkg(
		pkg.name,
		"custom",
		() => {
			let s = $`bash -c ${pkg.command}`;
			if ("env" in pkg && pkg.env) {
				s = s.env({ ...Bun.env, ...pkg.env });
			}
			return s;
		},
		"check" in pkg ? (pkg.check as string) : undefined,
	),
);

export const pkgs: Pkg[] = [
	...aptPkgs,
	...customPkgs,
	...brewPkgs,
	...bunPkgs,
	...uvPkgs,
	...dotnetPkgs,
];

/** Packages in `list` that are not currently installed. */
export const findMissing = async (list: readonly Pkg[]): Promise<Pkg[]> => {
	const results = await Promise.all(
		list.map(async (pkg) => ({ pkg, exists: await pkg.check() })),
	);
	return results.filter((r) => !r.exists).map((r) => r.pkg);
};

const logBatchStart = (label: string, names: string[]) =>
	console.log(`🕒 Installing ${label} packages: ${names.join(", ")}...`);

const logBatchDone = (label: string, result: InstallResult) => {
	if (result.ok) {
		console.log(`✅ Installed ${label} packages: ${result.names.join(", ")}`);
		return;
	}
	console.log(
		`❌ Failed to install some ${label} packages: ${result.names.join(", ")}`,
	);
	for (const [name, error] of Object.entries(result.failures)) {
		console.error(`   ${name}: ${error}`);
	}
};

/** Install a single package with `pkg.install()`, capturing the error message. */
const installOne = async (pkg: Pkg): Promise<string | undefined> => {
	try {
		await pkg.install();
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
};

/** Install `type`-keyed packages using that tool's native strategy (batch or sequential). */
export const installPkgs = async (
	type: keyof typeof installers,
	toInstall: readonly Pkg[],
): Promise<InstallResult> => {
	const tool = installers[type];
	const names = toInstall.map((p) => p.name);
	if (names.length === 0) {
		return { label: tool.label, names, ok: true, failures: {} };
	}
	logBatchStart(tool.label, names);
	const failures: Record<string, string> = {};
	if (tool.strategy === "batch") {
		try {
			await tool.run(names);
		} catch (error) {
			// A batch command fails as a whole; attribute the error to every package.
			const message = error instanceof Error ? error.message : String(error);
			for (const name of names) failures[name] = message;
		}
	} else {
		for (const pkg of toInstall) {
			const error = await installOne(pkg);
			if (error) failures[pkg.name] = error;
		}
	}
	const result: InstallResult = {
		label: tool.label,
		names,
		ok: Object.keys(failures).length === 0,
		failures,
	};
	logBatchDone(tool.label, result);
	return result;
};

/** Install `custom` packages one at a time (each carries its own command/env). */
const installCustomPkgs = async (
	toInstall: readonly Pkg[],
): Promise<InstallResult> => {
	const label = "custom";
	const names = toInstall.map((p) => p.name);
	if (names.length === 0) {
		return { label, names, ok: true, failures: {} };
	}
	const failures: Record<string, string> = {};
	for (const pkg of toInstall) {
		console.log(`🕒 Installing custom package ${pkg.name}...`);
		const error = await installOne(pkg);
		if (error) failures[pkg.name] = error;
		else console.log(`✅ Installed ${pkg.name}`);
	}
	return {
		label,
		names,
		ok: Object.keys(failures).length === 0,
		failures,
	};
};

/**
 * Install any mix of `Pkg`s, grouping by type and dispatching each group to its
 * tool's native strategy. Returns one structured result per non-empty group.
 */
export const installPkgsGrouped = async (
	toInstall: readonly Pkg[],
): Promise<InstallResult[]> => {
	const byType = new Map<PkgType, Pkg[]>();
	for (const pkg of toInstall) {
		const group = byType.get(pkg.type) ?? [];
		group.push(pkg);
		byType.set(pkg.type, group);
	}
	const results: InstallResult[] = [];
	for (const [type, group] of byType) {
		if (type === "custom" || type === "winget") {
			results.push(await installCustomPkgs(group));
		} else {
			results.push(await installPkgs(type, group));
		}
	}
	return results;
};
