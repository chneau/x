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

const doctorPkgs = async (canFix: boolean) => {
	const result = await Promise.all(
		pkgs.map(async (pkg) => ({
			name: pkg.name,
			exists: await pkg.check(),
			install: pkg.install,
		})),
	).then((x) => x.filter((y) => !y.exists));
	const ok = result.length === 0;
	if (ok) {
		console.log("✅ All packages are installed");
	} else {
		console.log("❌ Some packages are not installed");
		console.table(result);
		if (canFix) {
			for (const r of result) {
				console.log(`🕒 Installing ${r.name}`);
				await r.install();
				console.log(`✅ Installed ${r.name}`);
			}
		}
	}
	return ok;
};

const doctorGitconfig = async (canFix: boolean) => {
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
	const ok = gitconfig === expected;
	if (ok) {
		console.log("✅ Git config is set");
	} else {
		console.log("❌ Git config is not set");
		if (canFix) {
			console.log("🕒 Setting git config");
			await Bun.write(`${Bun.env.HOME}/.gitconfig`, expected);
			console.log("✅ Git config is set");
		}
	}
	return ok;
};

const doctorDotfiles = async (canFix: boolean) => {
	const baseFiles = "https://raw.githubusercontent.com/chneau/dotfiles/HEAD/";
	const expected = await Promise.all(
		[".bashrc", ".zshrc", ".aliases", ".profile"].map(async (x) => ({
			name: x,
			content: await fetch(`${baseFiles}${x}`).then((x) => x.text()),
		})),
	);
	const ok = await Promise.all(
		expected.map(
			async (x) =>
				(await Bun.file(`${Bun.env.HOME}/${x.name}`)
					.text()
					.catch(() => "")) === x.content,
		),
	).then((x) => x.every((y) => y));
	if (ok) {
		console.log("✅ Dotfiles are installed");
	} else {
		console.log("❌ Dotfiles are not installed");
		if (canFix) {
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
	}
	return ok;
};

const doctorUserGroups = async (canFix: boolean) => {
	const groups = await $`groups`.text();
	const ok = groups.includes("docker");
	if (ok) {
		console.log("✅ User is in docker groups");
	} else {
		console.log("❌ User is not in docker groups");
		if (canFix) {
			console.log("🕒 Adding user to docker groups");
			await $`sudo usermod -aG docker $USER`.catch(() => {});
			console.log("✅ User is in docker groups");
		}
	}
	return ok;
};

export const commandDoctor = async () => {
	const isRootOk = await doctorRoot();
	const isSudoOk = await doctorSudo();
	const canFix = isRootOk && isSudoOk;
	if (canFix) {
		console.log("⚡️ Fixable");
	} else {
		console.log("🔒 Not fixable");
	}
	await doctorGitconfig(canFix);
	await doctorDotfiles(canFix);
	await doctorUserGroups(canFix);
	await doctorPkgs(canFix);
};
