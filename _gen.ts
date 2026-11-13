import { $ } from "./utils/verboseShell";

await $`rm -rf dist`.nothrow();
await $`bun run check`.nothrow();
