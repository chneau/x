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
	brewIt("aichat"),
	brewIt("bpytop"),
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
	bunIt("oxlint"),
	bunIt("concurrently"),
	bunIt("ts-unused-exports"),
];
export const pkgs: Pkg[] = [
	...aptPkgs,
	{
		name: "brew",
		check: async () => commandExists("brew"),
		install: async () =>
			await $`HOME=/tmp CI=1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
	},
	{
		name: "deno",
		check: async () => commandExists("deno"),
		install: async () => await $`curl -fsSL https://deno.land/install.sh | sh`,
	},
	...brewPkgs,
	...bunPkgs,
];
