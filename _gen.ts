import { z } from "zod";
import { deploySchema } from "./commands/commandDeploy";
import { $ } from "./utils/verboseShell";

const jsonSchema = z.toJSONSchema(deploySchema, {
	io: "input",
	target: "draft-7",
});
await Bun.write(
	"deployment-schema.json",
	`${JSON.stringify(jsonSchema, null, 2)}\n`,
);
await $`rm -rf dist`.nothrow();
await $`bun run check`.nothrow();
