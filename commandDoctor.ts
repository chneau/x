import { $ } from "bun";
import config from "./config.json";
import {
	type DoctorOptions,
	doctorGitconfig,
	doctorGithub,
	doctorInotify,
	doctorSsh,
	doctorSshPermissions,
	optionsSchema,
} from "./doctorCommon";
import { canSudo, commandExists, isRoot } from "./helpers";
import {
	installAptPkgs,
	installBrewPkgs,
	installBunPkgs,
	installDotnetPkgs,
	installUvPkgs,
	pkgs,
} from "./pkgs";
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

const doctorUpdateSystem = async () => {
	console.log("🕒 Updating system...");

	// Apt
	await $`sudo apt update -y`.nothrow();
	await $`sudo apt upgrade -y`.nothrow();
	await $`sudo apt autoremove -y`.nothrow();
	await $`sudo apt autoclean -y`.nothrow();

	// Brew
	const brew = (await commandExists("brew"))
		? "brew"
		: "/home/linuxbrew/.linuxbrew/bin/brew";
	if (await Bun.file(brew).exists()) {
		await $`${brew} update`.nothrow();
		await $`${brew} upgrade`.nothrow();
		await $`${brew} cleanup`.nothrow();
	}

	// Bun
	await $`bun upgrade`.nothrow();
	await $`bun update --latest --force --global`.nothrow();

	// UV and UV global tools
	if (await commandExists("uv")) {
		console.log("🕒 Updating uv & uv tools...");
		await $`uv self update`.nothrow();
		await $`uv tool upgrade --all`.nothrow();
	}

	// Deno
	if (await commandExists("deno")) {
		console.log("🕒 Updating deno...");
		await $`deno upgrade`.nothrow();
	}

	// Rustup
	if (await commandExists("rustup")) {
		console.log("🕒 Updating rust toolchain...");
		await $`rustup update`.nothrow();
	}

	// Dotnet global tools
	if (await commandExists("dotnet")) {
		console.log("🕒 Updating dotnet tools...");
		const toolList = await $`dotnet tool list -g`.quiet().nothrow().text();
		const lines = toolList.split("\n").slice(2);
		for (const line of lines) {
			const toolName = line.trim().split(/\s+/)[0];
			if (toolName) {
				await $`dotnet tool update --global ${toolName}`.nothrow();
			}
		}
	}

	// Kubectl Krew plugins
	if (await commandExists("kubectl-krew")) {
		console.log("🕒 Updating krew plugins...");
		await $`kubectl krew upgrade`.nothrow();
	}

	console.log("✅ System updated");
};

const doctorPkgs = async () => {
	const missing = await Promise.all(
		pkgs.map(async (pkg) => ({
			pkg,
			exists: await pkg.check(),
		})),
	).then((results) => results.filter((r) => !r.exists).map((r) => r.pkg));

	if (missing.length === 0) {
		console.log("✅ All packages are installed");
		return;
	}

	console.log("❌ Some packages are not installed");
	console.table(missing.map((p) => ({ name: p.name, type: p.type })));

	const aptToInstall = missing.filter((p) => p.type === "apt");
	const brewToInstall = missing.filter((p) => p.type === "brew");
	const bunToInstall = missing.filter((p) => p.type === "bun");
	const uvToInstall = missing.filter((p) => p.type === "uv");
	const dotnetToInstall = missing.filter((p) => p.type === "dotnet");
	const customToInstall = missing.filter((p) => p.type === "custom");

	// Batch Apt
	if (aptToInstall.length > 0) {
		const names = aptToInstall.map((p) => p.name);
		console.log(`🕒 Batch installing apt packages: ${names.join(", ")}...`);
		try {
			await installAptPkgs(names);
			console.log(`✅ Installed apt packages: ${names.join(", ")}`);
		} catch {
			console.log(
				`❌ Failed to install some apt packages: ${names.join(", ")}`,
			);
		}
	}

	// Batch Brew
	if (brewToInstall.length > 0) {
		const names = brewToInstall.map((p) => p.name);
		console.log(`🕒 Batch installing brew packages: ${names.join(", ")}...`);
		try {
			await installBrewPkgs(names);
			console.log(`✅ Installed brew packages: ${names.join(", ")}`);
		} catch {
			console.log(
				`❌ Failed to install some brew packages: ${names.join(", ")}`,
			);
		}
	}

	// Batch Bun
	if (bunToInstall.length > 0) {
		const names = bunToInstall.map((p) => p.name);
		console.log(`🕒 Batch installing bun packages: ${names.join(", ")}...`);
		try {
			await installBunPkgs(names);
			console.log(`✅ Installed bun packages: ${names.join(", ")}`);
		} catch {
			console.log(
				`❌ Failed to install some bun packages: ${names.join(", ")}`,
			);
		}
	}

	// UV global tools
	if (uvToInstall.length > 0) {
		const names = uvToInstall.map((p) => p.name);
		console.log(`🕒 Installing uv tool packages: ${names.join(", ")}...`);
		try {
			await installUvPkgs(names);
			console.log(`✅ Installed uv tool packages: ${names.join(", ")}`);
		} catch {
			console.log(`❌ Failed to install some uv packages: ${names.join(", ")}`);
		}
	}

	// Dotnet global tools
	if (dotnetToInstall.length > 0) {
		const names = dotnetToInstall.map((p) => p.name);
		console.log(`🕒 Installing dotnet tool packages: ${names.join(", ")}...`);
		try {
			await installDotnetPkgs(names);
			console.log(`✅ Installed dotnet tool packages: ${names.join(", ")}`);
		} catch {
			console.log(
				`❌ Failed to install some dotnet packages: ${names.join(", ")}`,
			);
		}
	}

	// Individual Custom installs
	for (const pkg of customToInstall) {
		console.log(`🕒 Installing custom package ${pkg.name}...`);
		await pkg
			.install()
			.then(() => console.log(`✅ Installed ${pkg.name}`))
			.catch(() => console.log(`❌ Failed to install ${pkg.name}`));
	}
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
	console.log("🔍 Running doctor (Linux)...");
	console.log(
		"⚙️  email =",
		options.email,
		", name =",
		options.name,
		", updates =",
		options.updates,
	);
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
