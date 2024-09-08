import { $ } from "bun";
import { canSudo, isRoot } from "./helpers";
import { pkgs } from "./pkgs";

const doctorRoot = async () => {
	const ok = !(await isRoot());
	if (ok) console.log("✅ You are not root");
	else console.log("❌ You are root");
	return ok;
};

const doctorSudo = async () => {
	const ok = await canSudo();
	if (ok) console.log("✅ You can sudo");
	else console.log("❌ You cannot sudo");
	return ok;
};

const doctorPkgs = async () => {
	const result = await Promise.all(
		pkgs.map(async (pkg) => ({ name: pkg.name, exists: await pkg.check() })),
	).then((x) => x.filter((y) => !y.exists));
	const ok = result.length === 0;
	if (ok) {
		console.log("✅ All packages are installed");
	} else {
		console.log("❌ Some packages are not installed");
		console.table(result);
	}
	return ok;
};

const doctorGitconfig = async () => {
	const gitconfig = await $`git config --list --global`.text();
	const ok = ["user.email", "user.name", "url.ssh"].every((x) =>
		gitconfig.includes(x),
	);
	if (ok) {
		console.log("✅ Git config is set");
	} else {
		console.log("❌ Git config is not set");
	}
	return ok;
};

const doctorDotfiles = async () => {
	const dotfiles = await $`ls -a $HOME`.text();
	const ok = [".bashrc", ".zshrc", ".aliases", ".profile"].every((x) =>
		dotfiles.includes(x),
	);
	if (ok) {
		console.log("✅ Dotfiles are installed");
	} else {
		console.log("❌ Dotfiles are not installed");
	}
	return ok;
};

const doctorUserGroups = async () => {
	const groups = await $`groups`.text();
	const ok = ["sudo", "docker"].every((x) => groups.includes(x));
	if (ok) {
		console.log("✅ User is in sudo and docker groups");
	} else {
		console.log("❌ User is not in sudo and docker groups");
	}
	return ok;
};

export const commandDoctor = async () => {
	await doctorRoot();
	await doctorSudo();
	await doctorPkgs();
	await doctorGitconfig();
	await doctorDotfiles();
	await doctorUserGroups();
};
