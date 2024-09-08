import { $ } from "bun";
import { commandExists } from "./helpers";

type Pkg = {
	name: string;
	check: () => Promise<boolean>;
	install: () => Promise<unknown>;
};

const aptIt = (name: string) => ({
	name,
	check: async () => commandExists(name),
	install: async () => await $`sudo apt install -y ${name}`,
});

const aptPkgs: Pkg[] = [
	aptIt("git"),
	aptIt("curl"),
	aptIt("wget"),
	aptIt("unzip"),
	aptIt("bash"),
];

const brewIt = (name: string) => ({
	name,
	check: async () => commandExists(name),
	install: async () => await $`brew install ${name}`,
});

const brewPkgs: Pkg[] = [
	brewIt("bpytop"),
	brewIt("dive"),
	{
		...brewIt("docker-color-output"),
		install: async () => await $`brew install dldash/core/docker-color-output`,
	},
	brewIt("docker-compose"),
	brewIt("go"),
	brewIt("helm"),
	brewIt("hyperfine"),
	brewIt("kubecolor"),
	brewIt("kubectx"),
	{
		...brewIt("kubernetes-cli"),
		check: async () => commandExists("kubectl"),
	},
	brewIt("lazygit"),
	brewIt("node"),
	brewIt("pipx"),
	brewIt("zsh"),
];

const bunIt = (name: string) => ({
	name,
	check: async () => commandExists(name),
	install: async () => await $`bun install --force --global ${name}`,
});

const bunPkgs: Pkg[] = [
	{
		...bunIt("biome"),
		install: async () => await $`bun install --force --global @biomejs/biome`,
	},
	bunIt("http-server"),
	bunIt("live-server"),
	{
		...bunIt("fkill"),
		install: async () => await $`bun install --force --global fkill-cli`,
	},
	bunIt("ungit"),
	bunIt("npm-check"),
	bunIt("tsx"),
	bunIt("npm-check-updates"),
	bunIt("nodemon"),
	bunIt("prettier"),
	bunIt("typesync"),
	bunIt("depcheck"),
	bunIt("concurrently"),
	bunIt("ts-unused-exports"),
];
export const pkgs: Pkg[] = [...aptPkgs, ...brewPkgs, ...bunPkgs];