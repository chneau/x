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

export const commandDoctor = async () => {
	await doctorRoot();
	await doctorSudo();
	await doctorPkgs();
	await doctorGitconfig();
};
