import { $ } from "bun";
import { canSudo, isRoot } from "./helpers";
import { pkgs } from "./pkgs";

const doctorRoot = async () => {
	if (!(await isRoot())) console.log("✅ You are not root");
	else throw new Error("❌ You are root");
};

const doctorSudo = async () => {
	if (await canSudo()) console.log("✅ You can sudo");
	else throw new Error("❌ You cannot sudo");
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

const doctorGitconfig = async () => {
	const expected = `[user]
        email = charles63500@gmail.com
        name = chneau
[url "ssh://git@github.com/"]
        insteadOf = https://github.com/
[merge]
        ff = false
[pull]
        ff = true
        rebase = true
[core]
        whitespace = blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol
[fetch]
        prune = true
`;
	const gitconfig = await Bun.file(`${Bun.env.HOME}/.gitconfig`)
		.text()
		.catch(() => "");
	if (gitconfig === expected) {
		console.log("✅ Git config is set");
	} else {
		console.log("❌ Git config is not set");
		console.log("🕒 Setting git config");
		await Bun.write(`${Bun.env.HOME}/.gitconfig`, expected);
		console.log("✅ Git config is set");
	}
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
		console.log("🕒 Generating SSH key");
		await $`yes | ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -P ""`;
		console.log("✅ SSH key is set");
	}
};

const doctorGithub = async () => {
	if (
		await $`ssh git@github.com 2>&1`
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
			"🕒 Go to https://github.com/settings/ssh/new and past the text above",
		);
	}
};

const doctorZsh = async () => {
	const etcShells = await Bun.file("/etc/shells")
		.text()
		.then((x) => x.split("\n"));
	const whichZsh = await $`which zsh`.text();
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

export const commandDoctor = async () => {
	await Promise.all([doctorRoot(), doctorSudo()]);
	await Promise.all([
		doctorDotfiles(),
		doctorPkgs().then(() =>
			Promise.all([
				doctorGitconfig().then(doctorSsh).then(doctorGithub),
				doctorZsh(),
				doctorDocker().then(doctorUserGroups),
			]),
		),
	]);
};
