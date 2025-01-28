import { $ } from "bun";

const latest: { version: string } = await fetch(
	"https://registry.npmjs.org/@chneau/x/latest",
).then((x) => x.json());
const latestVersionFix = latest.version.split(".").map(Number).pop();
if (!latestVersionFix) throw new Error("latestVersionFix is not a number");
const version = `0.0.${latestVersionFix + 1}`;

await $`rm -rf dist`;
await $`bun build --outfile=dist/x.js --target=bun --sourcemap=inline --minimify index.ts`;
await Bun.write(
	"dist/package.json",
	JSON.stringify({ name: "@chneau/x", version, bin: "./x.js" }),
);
await $`bun publish`.cwd("dist");
await $`rm -rf dist`;
