import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const example = {
	registry: {
		host: "harbor.example.com/repository",
		username: "admin",
		password: "123",
	},
	image: {
		name: "image",
		dockerfile: "Dockerfile",
		tag: "latest",
		context: ".",
	},
	kube: {
		file: "kubeconfig",
		context: "ctx",
		namespace: "ns",
		name: "service",
		port: 3000,
		env: { ENV1: "1234", ENV2: "value" },
		endpoints: ["test.example.com"],
	},
};

const exampleSchema = z.object({
	registry: z
		.object({
			host: z.string(),
			username: z.string(),
			password: z.string(),
		})
		.optional(), // image is built locally
	image: z.object({
		name: z.string().optional(), // retrieved from package.json?
		dockerfile: z.string().default("Dockerfile"),
		tag: z.string().optional(), // retrieved from git short sha?
		context: z.string().default("."),
	}),
	kube: z.object({
		file: z.string().default("kubeconfig"),
		context: z.string().default(() => "eded"), // default to image name
		namespace: z.string().optional(), // default to image name
		name: z.string().optional(), // default to image name
		port: z.number().default(3000),
		env: z.record(z.string(), z.string()).optional(),
		endpoints: z.array(z.string()).optional(),
	}),
});

// Example usage
const parsed = exampleSchema.parse(example);

console.log(parsed);
const jsonSchema = zodToJsonSchema(exampleSchema, "mySchema");

console.dir(jsonSchema, { depth: null });
