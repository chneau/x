import { $ } from "bun";
import { fetchLatestVersion } from "./fetchLatestVersion";
import { getCurrentVersion } from "./helpers";

export const commandUpdate = async () => {
	const latestVersion = await fetchLatestVersion();
	const currentVersion = await getCurrentVersion();
	if (latestVersion === currentVersion) {
		console.log(
			`✅ You are already using the latest version ${currentVersion}`,
		);
		return;
	}
	console.log(`🕒 You are using version ${currentVersion}`);
	while (true) {
		console.log(`🕒 Updating to version ${latestVersion}`);
		const installed = await $`bun i -fg @chneau/x@${latestVersion}`
			.quiet()
			.then(() => true)
			.catch(() => false);
		if (installed) break;
		await Bun.sleep(1000);
	}
	console.log(`✅ Updated to version ${latestVersion}`);
};
