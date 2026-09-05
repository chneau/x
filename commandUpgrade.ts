import { $ } from "bun";
import { die, fetchLatestVersion, getCurrentVersion } from "./helpers";

export const commandUpgrade = async () => {
	const latestVersion = await fetchLatestVersion();
	const currentVersion = await getCurrentVersion();
	if (latestVersion === currentVersion) {
		console.log(
			`✅ You are already using the latest version ${currentVersion}`,
		);
		return;
	}
	console.log(`🕒 You are using version ${currentVersion}`);
	const maxRetries = 10;
	let success = false;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		console.log(
			`🕒 Updating to version ${latestVersion} (attempt ${attempt}/${maxRetries})`,
		);
		const { exitCode } = await $`bun i -fg @chneau/x@${latestVersion}`
			.quiet()
			.nothrow();
		if (exitCode === 0) {
			success = true;
			break;
		}
		if (attempt < maxRetries) {
			await Bun.sleep(1000);
		}
	}
	if (!success) {
		die(
			`❌ Failed to update to version ${latestVersion} after ${maxRetries} attempts`,
		);
	}
	console.log(`✅ Updated to version ${latestVersion}`);
};
