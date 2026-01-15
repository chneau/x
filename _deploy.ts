import { $ } from "bun";
import { fetchLatestVersion } from "./helpers";

const latestVersion = await fetchLatestVersion();
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
await $`bun publish`.cwd("dist").nothrow();
await $`rm -rf dist`;
