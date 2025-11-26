import { $ } from "bun";
import { commandExists } from "./helpers";

export type Pkg = {
	name: string;
	check: () => Promise<boolean>;
	install: () => Promise<unknown>;
};

export type PkgManager = {
	name: string;
	pkgs: Pkg[];
	update: () => Promise<unknown>;
	cleanup: () => Promise<unknown>;
	installPkgs: (pkgs: string[]) => Promise<unknown>;
};

const apt: PkgManager = {
	name: "apt",
	pkgs: ["git", "curl", "wget", "unzip", "zsh", "bash"].map((name) => ({
		name,
		check: async () => commandExists(name),
		install: async () => {
			await $`sudo apt install -y ${name}`;
		},
	})),
	update: async () => {
		await $`sudo apt update -y`;
		await $`sudo apt upgrade -y`;
	},
	cleanup: async () => {
		await $`sudo apt autoremove -y`;
		await $`sudo apt autoclean -y`;
	},
	installPkgs: async (pkgs: string[]) => {
		await $`sudo apt install -y ${{ raw: pkgs.join(" ") }}`;
	},
};

const brew: PkgManager = {
	name: "brew",
	pkgs: [
		{ name: "aichat" },
		{ name: "bpytop" },
		{ name: "dive" },
		{ name: "dldash/core/docker-color-output" },
		{ name: "docker-compose" },
		{ name: "go" },
		{ name: "graphviz", check: "dot" },
		{ name: "helm" },
		{ name: "hyperfine" },
		{ name: "kubecolor" },
		{ name: "kubectx" },
		{ name: "kubernetes-cli", check: "kubectl" },
		{ name: "lazygit" },
		{ name: "node" },
		{ name: "openjdk", check: "javac" },
		{ name: "pipx" },
		{ name: "zsh" },
	].map(({ name, check }) => ({
		name,
		check: async () => commandExists(check ?? name),
		install: async () => {
			await $`brew install ${name}`;
		},
	})),
	update: async () => {
		await $`brew update`;
		await $`brew upgrade`;
	},
	cleanup: async () => {
		await $`brew cleanup`;
	},
	installPkgs: async (pkgs: string[]) => {
		await $`brew install ${{
			raw: pkgs.join(" "),
		}}`;
	},
};

const bun: PkgManager = {
	name: "bun",
	pkgs: [
		{ name: "@biomejs/biome", check: "biome" },
		{ name: "concurrently" },
		{ name: "depcheck" },
		{ name: "fkill-cli", check: "fkill" },
		{ name: "http-server" },
		{ name: "live-server" },
		{ name: "nodemon" },
		{ name: "npm-check-updates" },
		{ name: "npm-check" },
		{ name: "opencode-ai", check: "opencode" },
		{ name: "oxlint" },
		{ name: "prettier" },
		{ name: "ts-unused-exports" },
		{ name: "tsx" },
		{ name: "typesync" },
		{ name: "ungit" },
	].map(({ name, check }) => ({
		name,
		check: async () => commandExists(check ?? name),
		install: async () => {
			await $`bun install --force --global ${name}`;
		},
	})),
	update: async () => {
		await $`bun upgrade`;
		await $`bun update --latest --force --global`;
	},
	cleanup: async () => {},
	installPkgs: async (pkgs: string[]) => {
		await $`bun install --force --global ${{ raw: pkgs.join(" ") }}`;
	},
};

export const pkgManagers = [apt, brew, bun];

export const pkgs: Pkg[] = [
	...apt.pkgs,
	...brew.pkgs,
	...bun.pkgs,
	{
		name: "brew",
		check: async () => commandExists("brew"),
		install: async () =>
			await $`CI=1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
	},
	{
		name: "deno",
		check: async () => commandExists("deno"),
		install: async () => await $`curl -fsSL https://deno.land/install.sh | sh`,
	},
];
