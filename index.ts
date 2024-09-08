#!/usr/bin/env bun
import { Command } from "commander";
import { fetchLatestVersion } from "./fetchLatestVersion";

const program = new Command();

const version = await Bun.file(`${import.meta.dir}/package.json`)
	.json()
	.then((x) => x.version as string);

(async () => {
	const latestVersion = await fetchLatestVersion();
	if (latestVersion !== version)
		console.log(`A new version is available: ${latestVersion}`);
})();

program //
	.name("x")
	.description("chneau's utility CLI")
	.version(version);

program.parse();
