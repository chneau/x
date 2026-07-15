import { $ } from "bun";
import {
	type DoctorOptions,
	doctorGitconfig,
	doctorGithub,
	doctorSsh,
} from "../doctorCommon";
import { installBunPkgs } from "../pkgs";
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
			type: pkg.type,
			exists: await pkg.check(),
			install: pkg.install,
		})),
	).then((x) => x.filter((y) => !y.exists));

	if (!result.length) {
		console.log("✅ All packages are installed");
	} else {
		console.log("❌ Some packages are not installed");
		console.table(result.map((r) => ({ name: r.name, type: r.type })));

		const wingetToInstall = result.filter((r) => r.type === "winget");
		const bunToInstall = result.filter((r) => r.type === "bun");

		// Winget (installed sequentially as winget does not natively support clean batch commands without chaining)
		for (const r of wingetToInstall) {
			console.log(`🕒 Installing ${r.name} via winget...`);
			await r
				.install()
				.then(() => console.log(`✅ Installed ${r.name}`))
				.catch(() => console.log(`❌ Failed to install ${r.name}`));
		}

		// Bun (batched)
		if (bunToInstall.length > 0) {
			const names = bunToInstall.map((r) => r.name);
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
