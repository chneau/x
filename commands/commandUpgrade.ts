import { $ } from "bun";
import {
	c,
	die,
	fetchLatestVersion,
	getCurrentVersion,
} from "../utils/helpers";

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
	let lastError = "";

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		console.log(
			`🕒 Updating to version ${latestVersion} (attempt ${attempt}/${maxRetries})`,
		);
		const res = await $`bun i -fg @chneau/x@${latestVersion}`.quiet().nothrow();
		if (res.exitCode === 0) {
			success = true;
			break;
		}
		lastError = res.stderr.toString().trim() || res.stdout.toString().trim();
		if (attempt < maxRetries) {
			if (lastError) {
				const firstLine = lastError.split("\n").filter(Boolean)[0] || "";
				console.log(`   ${c.yellow}⚠️ Attempt failed: ${firstLine}${c.reset}`);
			}
			await Bun.sleep(1000);
		}
	}
	if (!success) {
		die(
			`❌ Failed to update to version ${latestVersion} after ${maxRetries} attempts`,
			lastError
				? `Last error: ${lastError}`
				: "Check your network connection or permissions.",
		);
	}
	console.log(`✅ Updated to version ${latestVersion}`);
};
