import path from "node:path";
import { z } from "zod";
import { createDeployment } from "./cdk8s";
import { envSubst } from "./envSubst";

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
			registry: z.string().optional(),
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

type Deploy = z.infer<typeof deploySchema>;

export const commandDeploy = async () => {
	const args = Bun.argv.slice(3);
	const jsonFiles = args.filter((arg) => arg.endsWith(".json"));
	const filters = args.filter((arg) => !arg.endsWith(".json"));
	const isTargettingJsonFiles = jsonFiles.length > 0;
	if (jsonFiles.length === 0) {
		jsonFiles.push(
			...(await Bun.$`ls *.json`.text()).split("\n").filter(Boolean),
		);
	}
	let isFound = false;
	const promises: Promise<unknown>[] = [];
	for (const jsonFile of jsonFiles) {
		const file = Bun.file(jsonFile);
		const rawStr = await file.text().catch(() => null);
		if (!rawStr) continue;
		const envSubstStr = envSubst(rawStr);
		const rawJson = JSON.parse(envSubstStr);
		const parsed = await deploySchema.parseAsync(rawJson).catch(() => null);
		if (!parsed) continue;
		if (filters.length) {
			for (const key in parsed.services) {
				if (filters.includes(key)) continue;
				delete parsed.services[key];
			}
		}
		const serviceKeys = Object.keys(parsed.services);
		if (!serviceKeys.length) continue;
		isFound = true;

		for (const [serviceKey, service] of Object.entries(parsed.services)) {
			promises.push(
				deploy(
					{ ...parsed, services: { [serviceKey]: service } },
					path.dirname(jsonFile),
				),
			);
		}
	}
	if (!isFound && !isTargettingJsonFiles) {
		console.log("❌ TODO: create a template file");
	}
	if (isTargettingJsonFiles && !isFound) {
		console.log("❌ No valid json files found");
	}
	await Promise.all(promises);
};

const deploy = async (config: Deploy, cwd: string) => {
	for (const [serviceAlias, service] of Object.entries(config.services)) {
		console.log(`🕒 Deploying ${serviceAlias}...`);
		const image = config.images[service.image];
		if (!image) {
			console.error(`❌ Image ${service.image} not found`);
			continue;
		}
		const registry = image.registry ? config.registries[image.registry] : null;
		if (!registry) {
			console.info(`❓ Registry ${image.registry} not found`);
		} else {
			console.log(`🔑 Logging in to ${registry.hostname}...`);
			await Bun.$`echo ${registry.password} | docker login --username ${registry.username} --password-stdin ${registry.hostname}`;
			console.log(`... ✅ Logged in to ${registry.hostname}`);

			const imageFullName = `${registry.hostname}/${image.repository}/${image.imageName}:${image.tag}`;

			console.log(`🔨 Building ${imageFullName}...`);
			await Bun.$`docker build --pull --push -t ${imageFullName} -f ${image.dockerfile} ${image.context}`.cwd(
				cwd,
			);
			console.log(`... ✅ Built ${imageFullName}`);

			console.log(`🔗 Creating deployment for ${serviceAlias}...`);
			const deploymentYaml = await createDeployment({
				registryHost: registry.hostname,
				registryUsername: registry.username,
				registryPassword: registry.password,
				imageName: image.imageName,
				imageRepository: image.repository,
				imageTag: image.tag,
				kubePort: service.port,
				kubeEnv: service.env,
				kubeEndpoints: service.endpoints,
			});
			console.log(`... ✅ Created deployment for ${serviceAlias}`);

			console.log(`🚀 Deploying ${serviceAlias}...`);
			const kubeEnv = {
				...Bun.env,
				KUBECONFIG: path.join(cwd, service.file),
			};
			await Bun.$`echo ${deploymentYaml} | kubectl --context=${service.context} apply -f -`.env(
				kubeEnv,
			);
			console.log(`... ✅ Deployed ${serviceAlias}`);
		}
	}
};
