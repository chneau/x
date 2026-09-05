import { $ } from "bun";
import config from "./config.json";
import { commandExists } from "./helpers";

type PkgType = "apt" | "brew" | "bun" | "custom" | "winget" | "uv" | "dotnet";

export type Pkg = {
	name: string;
	type: PkgType;
	check: () => Promise<boolean>;
	install: () => Promise<unknown>;
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

/** Install command for a single package name per tool. */
const installers: Record<
	Exclude<PkgType, "custom" | "winget">,
	(name: string) => Promise<unknown>
> = {
	apt: (name) => $`sudo apt install -y ${name}`,
	brew: (name) => $`brew install ${name}`,
	bun: (name) => $`bun install --force --global ${name}`,
	uv: (name) => $`uv tool install --force ${name}`.nothrow(),
	dotnet: (name) =>
		$`dotnet tool install --global ${name} || dotnet tool update --global ${name}`.nothrow(),
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
			() => installers[type](name),
			typeof pkg === "string" ? undefined : pkg.check,
		);
	});

const aptPkgs = makePkgs("apt", config.packages.apt);

const brewPkgs = makePkgs("brew", config.packages.brew);

const bunPkgsMapped = makePkgs("bun", config.packages.bun);

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

/** Install `names` one by one with the per-tool installer. */
const sequential =
	(install: (name: string) => Promise<unknown>) => async (names: string[]) => {
		for (const name of names) await install(name);
	};

// apt/brew/bun batch their whole list into a single command.
export const installAptPkgs = async (names: string[]) => {
	await $`sudo apt install -y ${names}`;
};

export const installBrewPkgs = async (names: string[]) => {
	await $`brew install ${names}`;
};

export const installBunPkgs = async (names: string[]) => {
	await $`bun install --force --global ${names}`;
};

export const installUvPkgs = sequential(installers.uv);

export const installDotnetPkgs = sequential(installers.dotnet);

export const bunPkgs = bunPkgsMapped;

export const pkgs: Pkg[] = [
	...aptPkgs,
	...customPkgs,
	...brewPkgs,
	...bunPkgsMapped,
	...uvPkgs,
	...dotnetPkgs,
];

/** Packages in `pkgs` that are not currently installed. */
export const findMissing = async (pkgs: Pkg[]): Promise<Pkg[]> => {
	const results = await Promise.all(
		pkgs.map(async (pkg) => ({ pkg, exists: await pkg.check() })),
	);
	return results.filter((r) => !r.exists).map((r) => r.pkg);
};

/** Batch-install `toInstall` via `install`, logging progress and failures. */
export const installBatch = async (
	label: string,
	toInstall: Pkg[],
	install: (names: string[]) => Promise<unknown>,
) => {
	if (toInstall.length === 0) return;
	const names = toInstall.map((p) => p.name);
	console.log(`🕒 Batch installing ${label} packages: ${names.join(", ")}...`);
	try {
		await install(names);
		console.log(`✅ Installed ${label} packages: ${names.join(", ")}`);
	} catch {
		console.log(
			`❌ Failed to install some ${label} packages: ${names.join(", ")}`,
		);
	}
};
