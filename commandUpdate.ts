import { version, $ } from "bun";
import { fetchLatestVersion } from "./fetchLatestVersion";

export const commandUpdate = async () => {
	const latestVersion = await fetchLatestVersion();
	if (latestVersion === version) {
		console.log(`You are already using the latest version ${version}`);
		return;
	}
	await $`bun i -fg @chneau/x@${latestVersion}`;
	console.log(`Updated to version ${latestVersion}`);
};
