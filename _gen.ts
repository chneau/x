import { z } from "zod";
import { deploySchema } from "./commandDeploy";

const jsonSchema = z.toJSONSchema(deploySchema, {
	io: "input",
	target: "draft-7",
});
await Bun.write("deployment-schema.json", JSON.stringify(jsonSchema, null, 2));
await Bun.$`rm -rf dist`.nothrow();
await Bun.$`timeout 0.5 bun run check`.nothrow();
