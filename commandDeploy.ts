import { z } from "zod";

export const deploymentSchema = z.object({
	$schema: z.string().optional(),
	registries: z
		.record(
			z.object({
				hostname: z.string(),
				username: z.string(),
				password: z.string(),
			}),
		)
		.default({}),
	images: z.record(
		z.object({
			registry: z.string(),
			dockerfile: z.string().default("Dockerfile"),
			target: z.string().optional(),
			args: z.record(z.string()).default({}),
			context: z.string().default("."),
			repository: z.string(),
			imageName: z.string(),
			tag: z.string().default("latest"),
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
			env: z.record(z.string(), z.string()).default({}),
			endpoints: z
				.array(z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/))
				.default([]),
		}),
	),
});

export const commandDeploy = async () => {
	const args = Bun.argv.slice(3);
	const deployFileName = args[0] || ".deploy.json";
	const deployFile = Bun.file(deployFileName);
	const deployFileJson = await deployFile.json();
	const deployFileParsed = deploymentSchema.parse(deployFileJson);
	console.log(deployFileParsed);
};
