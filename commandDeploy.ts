import { z } from "zod";

export const deploySchema = z.object({
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
	const jsonFiles = args.filter((arg) => arg.endsWith(".json"));
	const filters = args.filter((arg) => !arg.endsWith(".json"));
	const isTargettingJsonFiles = jsonFiles.length > 0;
	if (jsonFiles.length === 0)
		jsonFiles.push(
			...(await Bun.$`ls *.json`.text()).split("\n").filter(Boolean),
		);
	let isFound = false;
	for (const jsonFile of jsonFiles) {
		const file = Bun.file(jsonFile);
		const rawJson = await file.json().catch(() => 0);
		const parsed = await deploySchema.parseAsync(rawJson).catch(() => null);
		if (!parsed) continue;
		const services = Object.keys(parsed.services).filter((x) =>
			filters.length ? filters.includes(x) : true,
		);
		if (services.length === 0) continue;
		isFound = true;
		console.log(`Found ${services.length} services to deploy`);
	}
	if (!isFound && !isTargettingJsonFiles) {
		console.log("TODO: create a template file");
	}
	if (isTargettingJsonFiles && !isFound) {
		console.log("No valid json files found");
	}
};
