import { $ } from "bun";
import { fetchLatestVersion } from "./fetchLatestVersion";
import { getCurrentVersion } from "./helpers";

export const commandUpdate = async () => {
	const latestVersion = await fetchLatestVersion();
	const currentVersion = await getCurrentVersion();
	if (latestVersion === currentVersion) {
		console.log(`You are already using the latest version ${currentVersion}`);
		return;
	}
	await $`bun i -fg @chneau/x@${latestVersion}`;
	console.log(`Updated to version ${latestVersion}`);
};
