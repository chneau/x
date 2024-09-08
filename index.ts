#!/usr/bin/env bun
import { $ } from "bun";
import { Command } from "commander";
import { fetchLatestVersion } from "./fetchLatestVersion";

const program = new Command();

const version = await Bun.file(`${import.meta.dir}/package.json`)
	.json()
	.then((x) => x.version as string);

(async () => {
	const latestVersion = await fetchLatestVersion();
	if (latestVersion !== version)
		console.log(
			`A new version is available: ${latestVersion}, you are using ${version}. Please run 'x update'`,
		);
})();

program //
	.name("x")
	.description("chneau's utility CLI")
	.version(version);

program.command("update").action(async () => {
	const latestVersion = await fetchLatestVersion();
	if (latestVersion === version) {
		console.log(`You are already using the latest version ${version}`);
		return;
	}
	await $`bun i -fg @chneau/x@${latestVersion}`;
	console.log(`Updated to version ${latestVersion}`);
});

program.parse();
