import { $ } from "bun";
import config from "../config.json";
import { commandExists } from "./helpers";
import { bunPkgs, dotnetPkgs, type Pkg, uvPkgs } from "./pkgs";

type WinPkg = Pkg;

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

type CustomConfig = {
	name: string;
	check?: string;
	commandWindows?: string;
};

const customWindowsPkgs: WinPkg[] = (config.packages.custom as CustomConfig[])
	.filter((pkg): pkg is CustomConfig & { commandWindows: string } =>
		Boolean(pkg.commandWindows),
	)
	.map((pkg) => ({
		name: pkg.name,
		type: "custom",
		check: async () => await commandExists(pkg.check ?? pkg.name),
		install: async () => await $`powershell.exe -Command ${pkg.commandWindows}`,
	}));

export const windowsPackages: WinPkg[] = [
	...wingetPkgs,
	...bunPkgs,
	...uvPkgs,
	...dotnetPkgs,
	...customWindowsPkgs,
];
