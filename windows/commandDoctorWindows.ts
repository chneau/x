import { $ } from "bun";
import {
	type DoctorOptions,
	doctorGitconfig,
	doctorGithub,
	doctorSsh,
} from "../doctorCommon";
import { windowsPackages } from "./windowsPkgs";

const doctorUpdateSystem = async () => {
	console.log("🕒 Updating system (winget upgrade --all)...");
	await $`winget upgrade --all --accept-package-agreements --accept-source-agreements`.nothrow();

	console.log("🕒 Updating Bun...");
	await $`bun upgrade`.nothrow();
	await $`bun update --latest --force --global`.nothrow();

	console.log("✅ System updated");
};

const doctorPkgs = async () => {
	const result = await Promise.all(
		windowsPackages.map(async (pkg) => ({
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

export const commandDoctorWindows = async (options: DoctorOptions) => {
	console.log("🔍 Running doctor (Windows)...");
	console.log(
		"⚙️  email =",
		options.email,
		", name =",
		options.name,
		", updates =",
		options.updates,
	);

	await doctorPkgs();
	await doctorGitconfig(options);
	try {
		await doctorSsh();
		await doctorGithub();
	} catch (e) {
		console.log(e);
	}

	if (options.updates) {
		await doctorUpdateSystem();
	} else {
		console.log("⚠️  Skipping system updates");
	}
	console.log("ℹ️  Restart your shell for installed packages to be available.");
};
