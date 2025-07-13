import { z } from "zod";
import { deploySchema } from "./commandDeploy";

const jsonSchema = z.toJSONSchema(deploySchema);
await Bun.write("deployment-schema.json", JSON.stringify(jsonSchema, null, 2));
await Bun.$`timeout 0.5 bun run check`.nothrow();
