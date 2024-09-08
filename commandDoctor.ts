import { $ } from "bun";
import { canSudo, isRoot } from "./helpers";
import { pkgs } from "./pkgs";

const doctorRoot = async () => {
	if (await isRoot()) console.log("❌ You are root");
	else console.log("✅ You are not root");
};

const doctorSudo = async () => {
	if (await canSudo()) console.log("✅ You can sudo");
	else console.log("❌ You cannot sudo");
};

const doctorPkgs = async () => {
	const result = await Promise.all(
		pkgs.map(async (pkg) => ({ name: pkg.name, exists: await pkg.check() })),
	).then((x) => x.filter((y) => !y.exists));
	if (result.length === 0) {
		console.log("✅ All packages are installed");
	} else {
		console.log("❌ Some packages are not installed");
		console.table(result);
	}
};

const doctorGitconfig = async () => {
	const gitconfig = await $`git config --list`.text();
	if (gitconfig.includes("user.email") && gitconfig.includes("user.name")) {
		console.log("✅ Git config is set");
	} else {
		console.log("❌ Git config is not set");
	}
};

const doctorDotfiles = async () => {
	const dotfiles = await $`ls -a $HOME`.text();
	const expected = [".bashrc", ".zshrc", ".aliases", ".profile"];
	if (expected.every((x) => dotfiles.includes(x))) {
		console.log("✅ Dotfiles are installed");
	} else {
		console.log("❌ Dotfiles are not installed");
	}
};

const doctorUserGroups = async () => {
	const groups = await $`groups`.text();
	if (groups.includes("sudo") && groups.includes("docker")) {
		console.log("✅ User is in sudo and docker groups");
	} else {
		console.log("❌ User is not in sudo and docker groups");
	}
};

export const commandDoctor = async () => {
	await doctorRoot();
	await doctorSudo();
	await doctorPkgs();
	await doctorGitconfig();
	await doctorDotfiles();
	await doctorUserGroups();
};
