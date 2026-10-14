import { fetchLatestVersion } from "./utils/helpers";
import { $ } from "./utils/verboseShell";

const latestVersion = await fetchLatestVersion();
if (!latestVersion) {
	throw new Error("Could not fetch the latest version of @chneau/x");
}
const lastPart = latestVersion.split(".").pop();
const latestVersionFix = Number(lastPart);
if (Number.isNaN(latestVersionFix)) {
	throw new Error(`latestVersionFix is not a number: ${lastPart}`);
}
const version = `0.0.${latestVersionFix + 1}`;

await $`rm -rf dist`;
await $`bun build --outfile=dist/x.js --target=bun --production index.ts`;
await Bun.write(
	"dist/package.json",
	JSON.stringify({ name: "@chneau/x", version, bin: "./x.js" }),
);
const publish = await $`bun publish`.cwd("dist").nothrow();
const publishError =
	publish.stderr.toString().trim() || publish.stdout.toString().trim();
await $`rm -rf dist`;
if (publish.exitCode !== 0) {
	throw new Error(
		`bun publish failed (exit ${publish.exitCode}): ${publishError}`,
	);
}
