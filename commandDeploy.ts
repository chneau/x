import path from "node:path";
import { z } from "zod";
import { createDeployment } from "./cdk8s";
import { envSubst } from "./envSubst";

const registrySchema = z.object({
	hostname: z.string(),
	username: z.string().nullish(),
	password: z.string().nullish(),
});

export type DeployRegistry = z.infer<typeof registrySchema>;

const imageSchema = z.object({
	registry: z.string(),
	dockerfile: z.string().default("Dockerfile"),
	target: z.string().optional(),
	buildArgs: z.record(z.string(), z.string()).default({}),
	context: z.string().default("."),
	repository: z.string(),
	imageName: z.string(),
	tag: z.string().default("latest"),
});

export type DeployImage = z.infer<typeof imageSchema>;

const normalServiceSchema = z.object({
	image: z.string(),
	replicas: z.number().default(1),
	file: z.string().default("kubeconfig"),
	context: z.string(),
	namespace: z.string(),
	port: z.number().min(1).max(65535).default(3000),
	env: z.record(z.string(), z.string()).default({}),
	readOnlyRootFilesystem: z.boolean().default(false),
	runAsUser: z.number().optional(),
	runAsGroup: z.number().optional(),
	runAsNonRoot: z.boolean().optional(),
	allowPrivilegeEscalation: z.boolean().optional(),
	privileged: z.boolean().optional(),
	endpoints: z
		.array(z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/))
		.default([]),
});

export type NormalDeployService = z.infer<typeof normalServiceSchema>;

const extendsServiceSchema = z.object({
	extends: z.string(),
	image: z.string().optional(),
	replicas: z.number().optional(),
	file: z.string().optional(),
	context: z.string().optional(),
	namespace: z.string().optional(),
	port: z.number().min(1).max(65535).optional(),
	env: z.record(z.string(), z.string()).optional(),
	readOnlyRootFilesystem: z.boolean().optional(),
	runAsUser: z.number().optional(),
	runAsGroup: z.number().optional(),
	runAsNonRoot: z.boolean().optional(),
	allowPrivilegeEscalation: z.boolean().optional(),
	privileged: z.boolean().optional(),
	endpoints: z
		.array(z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/))
		.optional(),
});

type ExtendsDeployService = z.infer<typeof extendsServiceSchema>;

const serviceSchema = normalServiceSchema.or(extendsServiceSchema);

type DeployService = z.infer<typeof serviceSchema>;

export const deploySchema = z.object({
	registries: z.record(z.string(), registrySchema).default({}),
	images: z.record(z.string(), imageSchema),
	services: z.record(z.string(), serviceSchema),
});

type Deploy = z.infer<typeof deploySchema>;

export const commandDeploy = async () => {
	const args = Bun.argv.slice(3);
	const jsonFiles = args.filter((arg) => arg.endsWith(".json"));
	const filters = args.filter((arg) => !arg.endsWith(".json"));
	const isTargettingJsonFiles = jsonFiles.length > 0;
	if (jsonFiles.length === 0) {
		jsonFiles.push(
			...(await Bun.$`ls *.json`.text().catch(() => ""))
				.split("\n")
				.filter(Boolean),
			".deploy.json",
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
		const copy = structuredClone(parsed);
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
				deploy({
					config: { ...parsed, services: { [serviceKey]: service } },
					allServices: copy.services,
					cwd: path.dirname(jsonFile),
				}),
			);
		}
	}
	if (!isFound && !isTargettingJsonFiles) {
		await createTemplateDeploy();
	}
	if (isTargettingJsonFiles && !isFound) {
		console.log("❌ No valid json files found");
	}
	await Promise.all(promises);
};

const createTemplateDeploy = async () => {
	console.log("🕒 Creating .deploy.json template...");
	const template = deploySchema.parse({
		$schema:
			"https://raw.githubusercontent.com/chneau/x/refs/heads/master/deployment-schema.json",
		registries: {
			dockerhub: {
				hostname: "docker.io",
				username: "username",
				password: "password",
			},
		},
		images: {
			"my-image": {
				registry: "dockerhub",
				repository: "my-repo",
				imageName: "my-image",
			},
		},
		services: {
			"my-service": {
				image: "my-image",
				file: "kubeconfig",
				context: "my-context",
				namespace: "my-namespace",
				env: {
					ENV: "value",
				},
				endpoints: ["my-endpoint.com"],
			},
		},
	});
	const templateStr = JSON.stringify(template, null, 2);
	const file = Bun.file(".deploy.json");
	if (await file.exists()) {
		console.log("❌ .deploy.json already exists");
		return;
	}
	await file.write(templateStr);
	console.log("✅ Created .deploy.json");
};

const extendsServiceToNormal = (
	service: ExtendsDeployService,
	services: Record<string, DeployService>,
	visited: string[] = [],
): NormalDeployService => {
	if (visited.includes(service.extends)) {
		throw new Error(
			`Circular dependency detected: ${visited.join(
				" -> ",
			)} -> ${service.extends}`,
		);
	}
	const nextVisited = [...visited, service.extends];

	const targetServiceRaw = services[service.extends];
	if (!targetServiceRaw) {
		throw new Error(`Service ${service.extends} not found`);
	}

	let targetService: NormalDeployService;
	if ("extends" in targetServiceRaw) {
		targetService = extendsServiceToNormal(
			targetServiceRaw,
			services,
			nextVisited,
		);
	} else {
		targetService = structuredClone(targetServiceRaw);
	}

	targetService.image = service.image ?? targetService.image;
	targetService.replicas = service.replicas ?? targetService.replicas;
	targetService.file = service.file ?? targetService.file;
	targetService.context = service.context ?? targetService.context;
	targetService.namespace = service.namespace ?? targetService.namespace;
	targetService.port = service.port ?? targetService.port;
	targetService.env = { ...targetService.env, ...service.env };
	targetService.readOnlyRootFilesystem =
		service.readOnlyRootFilesystem ?? targetService.readOnlyRootFilesystem;
	targetService.runAsUser = service.runAsUser ?? targetService.runAsUser;
	targetService.runAsGroup = service.runAsGroup ?? targetService.runAsGroup;
	targetService.runAsNonRoot =
		service.runAsNonRoot ?? targetService.runAsNonRoot;
	targetService.allowPrivilegeEscalation =
		service.allowPrivilegeEscalation ?? targetService.allowPrivilegeEscalation;
	targetService.privileged = service.privileged ?? targetService.privileged;
	targetService.endpoints = service.endpoints ?? targetService.endpoints;
	return targetService;
};

type DeployParams = {
	config: Deploy;
	allServices: Record<string, DeployService>;
	cwd: string;
};

const deploy = async ({ config, cwd, allServices }: DeployParams) => {
	for (const [serviceAlias, _service] of Object.entries(config.services)) {
		console.log(`🕒 Deploying ${serviceAlias}...`);
		const service =
			"extends" in _service
				? extendsServiceToNormal(_service, allServices)
				: _service;
		const image = config.images[service.image];
		if (!image) {
			console.error(`❌ Image ${service.image} not found`);
			continue;
		}
		const registry = image.registry ? config.registries[image.registry] : null;
		if (!registry) {
			console.info(`❓ Registry ${image.registry} not found`);
			continue;
		}
		if (registry.username && registry.password) {
			console.log(`🔑 Logging in to ${registry.hostname}...`);
			await Bun.$`echo ${registry.password} | docker login --username ${registry.username} --password-stdin ${registry.hostname}`;
			console.log(`... ✅ Logged in to ${registry.hostname}`);

			const imageFullName = `${registry.hostname}/${image.repository}/${image.imageName}:${image.tag}`;

			console.log(`🔨 Building ${imageFullName}...`);
			const buildArgs = Object.entries(image.buildArgs).map(
				([key, value]) => `--build-arg=${key}=${value}`,
			);
			const targetArg = image.target ? [`--target=${image.target}`] : [];
			await Bun.$`docker build --pull --push --tag=${imageFullName} ${targetArg} --file=${image.dockerfile} ${buildArgs} ${image.context}`;
			console.log(`... ✅ Built ${imageFullName}`);
		}

		console.log(`🔗 Creating deployment for ${serviceAlias}...`);
		const deploymentYaml = await createDeployment({
			serviceAlias,
			registry,
			image,
			service,
		});
		console.log(`... ✅ Created deployment for ${serviceAlias}`);

		console.log(`🚀 Deploying ${serviceAlias}...`);
		const kubeEnv = {
			...Bun.env,
			KUBECONFIG: path.join(cwd, service.file),
		};
		await Bun.$`echo ${deploymentYaml} | kubectl --context=${service.context} apply --filename=-`.env(
			kubeEnv,
		);
		console.log(`... ✅ Deployed ${serviceAlias}`);
	}
};
