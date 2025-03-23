import { z } from "zod";

export const deploymentSchema = z.object({
	$schema: z.string(),
	registries: z.record(
		z.object({
			hostname: z.string(),
			username: z.string(),
			password: z.string(),
		}),
	),
	images: z.record(
		z.object({
			registry: z.string(),
			dockerfile: z.string().default("Dockerfile"),
			target: z.string().optional(),
			args: z.record(z.string()).optional(),
			context: z.string().default("."),
			repository: z.string(),
			imageName: z.string(),
			tag: z.string().optional(),
		}),
	),
	services: z.record(
		z.object({
			image: z.string(),
			replicas: z.number().default(1),
			file: z.string().default("kubeconfig"),
			context: z.string(),
			namespace: z.string(),
			port: z.number().min(1).max(65535).default(3000),
			startupProbe: z.string().default("/"),
			env: z.record(z.string(), z.string()).optional(),
			endpoints: z
				.array(z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/))
				.default([]),
		}),
	),
});

export const commandDeploy = async () => {
	const args = Bun.argv.slice(3);
	const deployFile = args[0] || ".deploy.json";
	console.log(`Deploying from ${deployFile}`);
	const content = deploymentSchema.parse(await Bun.file(deployFile).json());
	console.dir(content, { depth: null });
	console.log("Deploying services");
};
