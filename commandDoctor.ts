import { $ } from "bun";
import config from "./config.json";
import {
	type DoctorOptions,
	doctorGitconfig,
	doctorGithub,
	doctorSsh,
	optionsSchema,
} from "./doctorCommon";
import { canSudo, commandExists, isRoot } from "./helpers";
import { pkgs } from "./pkgs";
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
	console.table(missing.map((p) => ({ name: p.name })));

	for (const pkg of missing) {
		console.log(`🕒 Installing ${pkg.name}...`);
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

// TODO: install dotnet

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
				doctorGitconfig(options).then(doctorSsh).then(doctorGithub),
				doctorZsh(),
				doctorDocker().then(doctorUserGroups),
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
