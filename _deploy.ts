import { $ } from "bun";
import pkg from "./package.json";

await $`rm -rf dist`;
await $`bun build --outfile=dist/x.js --target=bun --sourcemap=inline --minimify x.ts`;
const slimPkg = { name: pkg.name, version: pkg.version, bin: pkg.bin };
await Bun.write("dist/package.json", JSON.stringify(slimPkg));
await $`bun pm pack`.cwd("dist");
await $`npm publish *.tgz`.cwd("dist");
await $`rm -rf dist`;
