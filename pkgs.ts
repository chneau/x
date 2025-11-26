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
	aptIt("zsh"),
	aptIt("bash"),
];

const brewIt = (name: string, check?: string) => ({
	name,
	check: async () => commandExists(check ?? name),
	install: async () => await $`brew install ${name}`,
});

const brewPkgs: Pkg[] = [
	brewIt("aichat"),
	brewIt("bpytop"),
	brewIt("dive"),
	brewIt("dldash/core/docker-color-output", "docker-color-output"),
	brewIt("docker-compose"),
	brewIt("go"),
	brewIt("graphviz", "dot"),
	brewIt("helm"),
	brewIt("hyperfine"),
	brewIt("kubecolor"),
	brewIt("kubectx"),
	brewIt("kubernetes-cli", "kubectl"),
	brewIt("lazygit"),
	brewIt("node"),
	brewIt("openjdk", "javac"),
	brewIt("pipx"),
	brewIt("zsh"),
];

const bunIt = (name: string, check?: string) => ({
	name,
	check: async () => commandExists(check ?? name),
	install: async () => await $`bun install --force --global ${name}`,
});

const bunPkgs: Pkg[] = [
	bunIt("@biomejs/biome", "biome"),
	bunIt("@google/gemini-cli", "gemini"),
	bunIt("opencode-ai", "opencode"),
	bunIt("concurrently"),
	bunIt("depcheck"),
	bunIt("fkill-cli", "fkill"),
	bunIt("http-server"),
	bunIt("live-server"),
	bunIt("nodemon"),
	bunIt("npm-check-updates"),
	bunIt("npm-check"),
	bunIt("oxlint"),
	bunIt("prettier"),
	bunIt("ts-unused-exports"),
	bunIt("tsx"),
	bunIt("typesync"),
	bunIt("ungit"),
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
