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

const aptIt = (name: string) =>
	createPkg(name, "apt", () => $`sudo apt install -y ${name}`);

const brewIt = (name: string, check?: string) =>
	createPkg(name, "brew", () => $`brew install ${name}`, check);

const bunIt = (name: string, check?: string) =>
	createPkg(name, "bun", () => $`bun install --force --global ${name}`, check);

const uvIt = (name: string, check?: string) =>
	createPkg(
		name,
		"uv",
		() => $`uv tool install --force ${name}`.nothrow(),
		check,
	);

const dotnetIt = (name: string, check?: string) =>
	createPkg(
		name,
		"dotnet",
		() =>
			$`dotnet tool install --global ${name} || dotnet tool update --global ${name}`.nothrow(),
		check,
	);

const aptPkgs: Pkg[] = config.packages.apt.map(aptIt);

const brewPkgs: Pkg[] = config.packages.brew.map((pkg) =>
	brewIt(pkg.name, "check" in pkg ? pkg.check : undefined),
);

const bunPkgsMapped: Pkg[] = config.packages.bun.map((pkg) =>
	bunIt(pkg.name, "check" in pkg ? pkg.check : undefined),
);

const uvPkgs: Pkg[] = (config.packages.uv || []).map((pkg) =>
	uvIt(pkg.name, "check" in pkg ? (pkg.check as string) : undefined),
);

const dotnetPkgs: Pkg[] = (config.packages.dotnet || []).map((pkg) =>
	dotnetIt(pkg.name, "check" in pkg ? (pkg.check as string) : undefined),
);

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

export const installAptPkgs = async (names: string[]) => {
	await $`sudo apt install -y ${names}`;
};

export const installBrewPkgs = async (names: string[]) => {
	await $`brew install ${names}`;
};

export const installBunPkgs = async (names: string[]) => {
	await $`bun install --force --global ${names}`;
};

export const installUvPkgs = async (names: string[]) => {
	for (const name of names) {
		await $`uv tool install --force ${name}`.nothrow();
	}
};

export const installDotnetPkgs = async (names: string[]) => {
	for (const name of names) {
		await $`dotnet tool install --global ${name} || dotnet tool update --global ${name}`.nothrow();
	}
};

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
