import zodToJsonSchema from "zod-to-json-schema";
import { deploySchema } from "./commandDeploy";

const jsonSchema = zodToJsonSchema(deploySchema, "chneau-deployment-schema");
await Bun.write("deployment-schema.json", JSON.stringify(jsonSchema, null, 2));
await Bun.$`timeout 0.5 bun run check`.nothrow();
