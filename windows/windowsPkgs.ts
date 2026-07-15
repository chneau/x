import { $ } from "bun";
import config from "../config.json";
import { commandExists } from "../helpers";
import { bunPkgs, type Pkg } from "../pkgs";

type WinPkg = Pkg & { type: "winget" | "bun" };

const wingetIt = (id: string, cmd?: string): WinPkg => ({
	name: id,
	type: "winget",
	check: async () => await commandExists(cmd ?? id),
	install: async () =>
		await $`powershell.exe -Command "winget install --id ${id} -e --source winget --accept-package-agreements --accept-source-agreements"`,
});

const wingetPkgs: WinPkg[] = config.packages.winget.map((pkg) =>
	wingetIt(pkg.name, "check" in pkg ? pkg.check : undefined),
);

export const windowsPackages: WinPkg[] = [
	...wingetPkgs,
	...(bunPkgs as WinPkg[]),
];
