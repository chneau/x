import { $ } from "bun";
import {
	type DoctorOptions,
	doctorGitconfig,
	doctorGithub,
	doctorSsh,
} from "../doctorCommon";
import { findMissing, installBatch, installBunPkgs } from "../pkgs";
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
	const result = await findMissing(windowsPackages);

	if (!result.length) {
		console.log("✅ All packages are installed");
		return;
	}

	console.log("❌ Some packages are not installed");
	console.table(result.map((r) => ({ name: r.name, type: r.type })));

	const wingetToInstall = result.filter((r) => r.type === "winget");
	const bunToInstall = result.filter((r) => r.type === "bun");

	// Winget (installed sequentially as winget does not natively support clean batch commands without chaining)
	for (const pkg of wingetToInstall) {
		console.log(`🕒 Installing ${pkg.name} via winget...`);
		await pkg
			.install()
			.then(() => console.log(`✅ Installed ${pkg.name}`))
			.catch(() => console.log(`❌ Failed to install ${pkg.name}`));
	}

	// Bun (batched)
	await installBatch("bun", bunToInstall, installBunPkgs);
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
