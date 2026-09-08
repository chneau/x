import { $ } from "bun";
import config from "./config.json";
import {
	type DoctorOptions,
	doctorGitconfig,
	doctorGithub,
	doctorInotify,
	doctorSsh,
	doctorSshPermissions,
	logDoctorStart,
	optionsSchema,
} from "./doctorCommon";
import { canSudo, commandExists, isRoot } from "./helpers";
import { findMissing, installCustomPkgs, installPkgs, pkgs } from "./pkgs";
import { commandDoctorWindows } from "./windows/commandDoctorWindows";

if (process.platform !== "win32") {
	Bun.env.PATH = [
		Bun.env.PATH ?? "",
		"/home/linuxbrew/.linuxbrew/bin",
		"/home/linuxbrew/.linuxbrew/sbin",
		"$BUN_INSTALL/bin",
		"$HOME/go/bin",
		"$HOME/.arkade/bin",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: it's what I actually expect
		"${KREW_ROOT:-$HOME/.krew}/bin",
		"$HOME/.cargo/bin",
		"$HOME/.dotnet",
		"$HOME/.dotnet/tools",
		"$HOME/.go/bin",
		"$HOME/.local/bin",
		"$HOME/bin",
		"/snap/bin",
		"/usr/local/sbin",
		"/usr/sbin",
		"/sbin",
	].join(":");
}

const doctorRoot = async () => {
	if (!(await isRoot())) console.log("✅ You are not root");
	else throw new Error("❌ You are root");
};

const doctorSudo = async () => {
	if (await canSudo()) console.log("✅ You can sudo");
	else {
		console.log("⚡ Please run this command to configure sudo:");
		console.log(
			`sudo sed -i 's/%sudo\\s\\+ALL=(ALL:ALL)\\s\\+ALL/%sudo ALL=(ALL:ALL) NOPASSWD: ALL/g' /etc/sudoers`,
		);
		throw new Error("❌ You cannot sudo");
	}
};

type UpdateStep = {
	label: string;
	/** Omit when the tool check is unnecessary (e.g. bundled tools). */
	check?: string;
	run: () => Promise<unknown>;
};

/** Tool updates, applied uniformly over the table. */
const updateSteps: UpdateStep[] = [
	{
		label: "brew",
		run: async () => {
			const brew = (await commandExists("brew"))
				? "brew"
				: "/home/linuxbrew/.linuxbrew/bin/brew";
			if (await Bun.file(brew).exists()) {
				await $`${brew} update`.nothrow();
				await $`${brew} upgrade`.nothrow();
				await $`${brew} cleanup`.nothrow();
			}
		},
	},
	{
		label: "bun",
		run: async () => {
			await $`bun upgrade`.nothrow();
			await $`bun update --latest --force --global`.nothrow();
		},
	},
	{
		label: "uv & uv tools",
		check: "uv",
		run: async () => {
			await $`uv self update`.nothrow();
			await $`uv tool upgrade --all`.nothrow();
		},
	},
	{
		label: "deno",
		check: "deno",
		run: () => $`deno upgrade`.nothrow(),
	},
	{
		label: "rust toolchain",
		check: "rustup",
		run: () => $`rustup update`.nothrow(),
	},
	{
		label: "dotnet tools",
		check: "dotnet",
		run: async () => {
			const toolList = await $`dotnet tool list -g`.quiet().nothrow().text();
			const lines = toolList.split("\n").slice(2);
			for (const line of lines) {
				const toolName = line.trim().split(/\s+/)[0];
				if (toolName) {
					await $`dotnet tool update --global ${toolName}`.nothrow();
				}
			}
		},
	},
	{
		label: "krew plugins",
		check: "kubectl-krew",
		run: () => $`kubectl krew upgrade`.nothrow(),
	},
];

const doctorUpdateSystem = async () => {
	console.log("🕒 Updating system...");

	await $`sudo apt update -y`.nothrow();
	await $`sudo apt upgrade -y`.nothrow();
	await $`sudo apt autoremove -y`.nothrow();
	await $`sudo apt autoclean -y`.nothrow();

	for (const step of updateSteps) {
		if (step.check && !(await commandExists(step.check))) continue;
		console.log(`🕒 Updating ${step.label}...`);
		await step.run();
	}

	console.log("✅ System updated");
};

const doctorPkgs = async () => {
	const missing = await findMissing(pkgs);

	if (missing.length === 0) {
		console.log("✅ All packages are installed");
		return;
	}

	console.log("❌ Some packages are not installed");
	console.table(missing.map((p) => ({ name: p.name, type: p.type })));

	const byType = (type: (typeof pkgs)[number]["type"]) =>
		missing.filter((p) => p.type === type);

	await installPkgs("apt", byType("apt"));
	await installPkgs("brew", byType("brew"));
	await installPkgs("bun", byType("bun"));
	await installPkgs("uv", byType("uv"));
	await installPkgs("dotnet", byType("dotnet"));
	await installCustomPkgs(byType("custom"));
};

const checkLogFix = async (
	name: string,
	check: () => Promise<boolean>,
	fix: () => Promise<unknown>,
) => {
	if (await check()) {
		console.log(`✅ ${name} is correct`);
	} else {
		console.log(`❌ ${name} is incorrect`);
		console.log(`🕒 Fixing ${name}...`);
		await fix();
		console.log(`✅ ${name} is fixed`);
	}
};

const doctorDotfiles = async () => {
	const baseFiles = config.dotfiles.baseUrl;
	const files = [".bashrc", ".zshrc", ".aliases", ".profile"];
	const results = await Promise.all(
		files.map(async (name) => ({
			name,
			isPresent: await Bun.file(`${Bun.env.HOME}/${name}`).exists(),
		})),
	);

	if (results.every((x) => x.isPresent)) {
		console.log("✅ Dotfiles are installed");
		return;
	}

	console.log("❌ Dotfiles are not installed");
	console.log("🕒 Installing dotfiles");
	await Promise.all(
		results
			.filter((x) => !x.isPresent)
			.map(async (x) => {
				console.log(`🕒 Installing ${x.name}`);
				const content = await fetch(`${baseFiles}${x.name}`).then((r) =>
					r.text(),
				);
				await Bun.write(`${Bun.env.HOME}/${x.name}`, content);
				console.log(`✅ Installed ${x.name}`);
			}),
	);
	console.log("✅ Dotfiles are installed");
};

const doctorDocker = () =>
	checkLogFix(
		"Docker",
		() => commandExists("docker"),
		() => $`curl -sSL get.docker.com | sh`,
	);

const doctorUserGroups = () =>
	checkLogFix(
		"User in docker group",
		async () => (await $`groups`.text()).includes("docker"),
		() => $`sudo usermod -aG docker $USER`.nothrow(),
	);

const doctorZsh = async () => {
	const whichZsh = (await $`which zsh`.text()).trim();
	await checkLogFix(
		"Zsh is set as a valid shell",
		async () => (await Bun.file("/etc/shells").text()).includes(whichZsh),
		() => $`echo ${whichZsh} | sudo tee -a /etc/shells`,
	);
	await checkLogFix(
		"Zsh is set as your shell",
		async () =>
			(await $`cat /etc/passwd | grep "^$USER:"`.text()).includes(whichZsh),
		() => $`sudo chsh -s ${whichZsh} $USER`,
	);
};

const commandDoctorLinux = async (options: DoctorOptions) => {
	logDoctorStart("Linux", options);
	await Promise.all([doctorRoot(), doctorSudo()]);
	await Promise.all([
		doctorDotfiles(),
		doctorPkgs().then(() =>
			Promise.all([
				doctorGitconfig(options)
					.then(doctorSsh)
					.then(doctorSshPermissions)
					.then(doctorGithub),
				doctorZsh(),
				doctorDocker().then(doctorUserGroups),
				doctorInotify(),
			]),
		),
	]);
	if (options.updates) {
		await doctorUpdateSystem();
	} else {
		console.log("⚠️  Skipping system updates");
	}
};

export const commandDoctor = async (options: DoctorOptions) => {
	options = optionsSchema.parse(options);
	if (process.platform === "win32") {
		await commandDoctorWindows(options);
	} else {
		await commandDoctorLinux(options);
	}
};
