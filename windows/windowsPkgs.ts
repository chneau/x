import { $ } from "bun";
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

const wingetPkgs: WinPkg[] = [
	wingetIt("Git.Git", "git"),
	wingetIt("GoLang.Go", "go"),
	wingetIt("OpenJS.NodeJS", "node"),
	wingetIt("DenoLand.Deno", "deno"),
	wingetIt("JesseDuffield.Lazygit", "lazygit"),
	wingetIt("Microsoft.VisualStudioCode", "code"),
	wingetIt("Kubernetes.kubectl", "kubectl"),
	wingetIt("Helm.Helm", "helm"),
	// Common tools
	wingetIt("JanDeDobbeleer.OhMyPosh", "oh-my-posh"),
];

export const windowsPackages: WinPkg[] = [
	...wingetPkgs,
	...(bunPkgs as WinPkg[]),
];
