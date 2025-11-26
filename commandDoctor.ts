import { $ } from "bun";
import z from "zod";
import { canSudo, isRoot } from "./helpers";
import { pkgs } from "./pkgs";

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

const doctorRoot = async () => {
	if (!(await isRoot())) console.log("✅ You are not root");
	else throw new Error("❌ You are root");
};

const doctorSudo = async () => {
	if (await canSudo()) console.log("✅ You can sudo");
	else throw new Error("❌ You cannot sudo");
};

const doctorUpdateSystem = async () => {
	console.log("🕒 Updating system...");

	// Apt
	await $`sudo apt update -y`.nothrow();
	await $`sudo apt upgrade -y`.nothrow();
	await $`sudo apt autoremove -y`.nothrow();
	await $`sudo apt autoclean -y`.nothrow();

	// Brew
	const brew =
		(await $`which brew`.text().catch(() => "")).trim() ||
		"/home/linuxbrew/.linuxbrew/bin/brew";
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
	const result = await Promise.all(
		pkgs.map(async (pkg) => ({
			name: pkg.name,
			exists: await pkg.check(),
			install: pkg.install,
		})),
	).then((x) => x.filter((y) => !y.exists));
	if (!result.length) {
		console.log("✅ All packages are installed");
	} else {
		console.log("❌ Some packages are not installed");
		console.table(result);
		for (const r of result) {
			console.log(`🕒 Installing ${r.name}`);
			await r
				.install()
				.then(() => console.log(`✅ Installed ${r.name}`))
				.catch(() => console.log(`❌ Failed to install ${r.name}`));
		}
	}
};

const optionsSchema = z.object({
	email: z.email(),
	name: z.string().min(1),
	updates: z.boolean(),
});
type DoctorOptions = z.infer<typeof optionsSchema>;

const doctorGitconfig = async (options: DoctorOptions) => {
	const currentName = await $`git config --global user.name`.nothrow().text();
	const currentEmail = await $`git config --global user.email`.nothrow().text();

	if (currentName.trim() === "") {
		console.log("❌ Git user.name is not set");
		console.log("🕒 Setting git user.name");
		await $`git config --global user.name ${options.name}`;
		console.log("✅ Git user.name set");
	} else {
		console.log(`✅ Git user.name is already set to "${currentName.trim()}"`);
	}

	if (currentEmail.trim() === "") {
		console.log("❌ Git user.email is not set");
		console.log("🕒 Setting git user.email");
		await $`git config --global user.email ${options.email}`;
		console.log("✅ Git user.email set");
	} else {
		console.log(`✅ Git user.email is already set to "${currentEmail.trim()}"`);
	}

	// Set other configurations
	await $`git config --global url."ssh://git@github.com/".insteadOf "https://github.com/"`;
	await $`git config --global merge.ff false`;
	await $`git config --global pull.ff true`;
	await $`git config --global pull.rebase true`;
	await $`git config --global core.whitespace "blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol"`;
	await $`git config --global fetch.prune true`;

	console.log("✅ Git config checked and updated.");
};

const doctorDotfiles = async () => {
	const baseFiles = "https://raw.githubusercontent.com/chneau/dotfiles/HEAD/";
	const expected = await Promise.all(
		[".bashrc", ".zshrc", ".aliases", ".profile"].map(async (x) => ({
			name: x,
			content: await fetch(`${baseFiles}${x}`).then((x) => x.text()),
			isPresent: await Bun.file(`${Bun.env.HOME}/${x}`).exists(),
		})),
	);
	if (expected.every((x) => x.isPresent)) {
		console.log("✅ Dotfiles are installed");
	} else {
		console.log("❌ Dotfiles are not installed");
		console.log("🕒 Installing dotfiles");
		await Promise.all(
			expected.map(async (x) => {
				console.log(`🕒 Installing ${x.name}`);
				await Bun.write(`${Bun.env.HOME}/${x.name}`, x.content);
				console.log(`✅ Installed ${x.name}`);
			}),
		);
		console.log("✅ Dotfiles are installed");
	}
};

const doctorDocker = async () => {
	if (!(await $`which docker`.nothrow().text()).includes("not found")) {
		console.log("✅ Docker is installed");
	} else {
		console.log("❌ Docker is not installed");
		console.log("🕒 Installing Docker");
		await $`curl -sSL get.docker.com | sh`;
		console.log("✅ Docker is installed");
	}
};

const doctorUserGroups = async () => {
	const groups = await $`groups`.text();
	if (groups.includes("docker")) {
		console.log("✅ User is in docker groups");
	} else {
		console.log("❌ User is not in docker groups");
		console.log("🕒 Adding user to docker groups");
		await $`sudo usermod -aG docker $USER`.catch(() => {});
		console.log("✅ User is in docker groups");
	}
};

const doctorSsh = async () => {
	const sshDir = `${Bun.env.HOME}/.ssh/id_rsa`;
	if (await Bun.file(sshDir).exists()) {
		console.log("✅ SSH key is set");
	} else {
		console.log("❌ SSH key is not set");
		console.log(
			'⚡ Please execute this command:\n\nssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -P ""',
		);
		throw new Error("❌ SSH key is not set");
	}
};

const doctorGithub = async () => {
	if (
		await $`ssh -o "StrictHostKeyChecking no" git@github.com 2>&1`
			.nothrow()
			.text()
			.then((x) => x.includes("successfully authenticated"))
	) {
		console.log("✅ SSH key is set on GitHub");
	} else {
		console.log("❌ SSH key is not set on GitHub");
		console.log("🕒 Adding SSH key to GitHub");
		await $`cat ~/.ssh/id_rsa.pub`;
		console.log(
			"⚡ Go to https://github.com/settings/ssh/new and past the text above",
		);
	}
};

// TODO: install dotnet

const doctorZsh = async () => {
	const etcShells = await Bun.file("/etc/shells")
		.text()
		.then((x) => x.split("\n"));
	const whichZsh = await $`which zsh`.nothrow().text();
	if (etcShells.includes(whichZsh)) {
		console.log("✅ Zsh is set as a valid shell");
	} else {
		console.log("❌ Zsh is not set as a valid shell");
		console.log("🕒 Adding Zsh to /etc/shells");
		await $`echo ${whichZsh} | sudo tee -a /etc/shells`;
		console.log("✅ Zsh is set as a valid shell");
	}
	const etcPasswdOfUSer = await $`cat /etc/passwd | grep "^$USER:"`.text();
	if (etcPasswdOfUSer.includes(whichZsh)) {
		console.log("✅ Zsh is set as your shell");
	} else {
		console.log("❌ Zsh is not set as your shell");
		console.log("🕒 Setting Zsh as your shell");
		await $`sudo chsh -s ${whichZsh} $USER`;
		console.log("✅ Zsh is set as your shell");
	}
};

export const commandDoctor = async (options: DoctorOptions) => {
	options = optionsSchema.parse(options);
	console.log("🔍 Running doctor...");
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
