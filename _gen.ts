import { z } from "zod";
import { deploySchema } from "./commands/commandDeploy";

const jsonSchema = z.toJSONSchema(deploySchema, {
	io: "input",
	target: "draft-7",
});
await Bun.write(
	"deployment-schema.json",
	`${JSON.stringify(jsonSchema, null, 2)}\n`,
);
await Bun.$`rm -rf dist`.nothrow();
await Bun.$`bun run check`.nothrow();
