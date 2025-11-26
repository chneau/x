import { $ } from "bun";
import { commandExists } from "../helpers";
import { bunPkgs } from "../pkgs";

type Pkg = {
	name: string;
	check: () => Promise<boolean>;
	install: () => Promise<unknown>;
};

const wingetIt = (id: string, cmd?: string) => ({
	name: id,
	check: async () => await commandExists(cmd ?? id),
	install: async () =>
		await $`powershell.exe -Command "winget install --id ${id} -e --source winget --accept-package-agreements --accept-source-agreements"`,
});

const wingetPkgs: Pkg[] = [
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

export const windowsPackages: Pkg[] = [...wingetPkgs, ...bunPkgs];
