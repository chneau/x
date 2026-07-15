import { $ } from "bun";
import config from "./config.json";
import { commandExists } from "./helpers";

type PkgType = "apt" | "brew" | "bun" | "custom" | "winget";

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

const aptPkgs: Pkg[] = config.packages.apt.map(aptIt);

const brewPkgs: Pkg[] = config.packages.brew.map((pkg) =>
	brewIt(pkg.name, "check" in pkg ? pkg.check : undefined),
);

const bunPkgsMapped: Pkg[] = config.packages.bun.map((pkg) =>
	bunIt(pkg.name, "check" in pkg ? pkg.check : undefined),
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

export const bunPkgs = bunPkgsMapped;

export const pkgs: Pkg[] = [
	...aptPkgs,
	...customPkgs,
	...brewPkgs,
	...bunPkgsMapped,
];
