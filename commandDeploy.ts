import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createDeployment } from "./cdk8s";
import { envSubst } from "./helpers";

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

const serviceBase = z.object({
	image: z.string(),
	replicas: z.number(),
	file: z.string(),
	context: z.string(),
	namespace: z.string(),
	port: z.number().min(1).max(65535),
	env: z.record(z.string(), z.string()),
	readOnlyRootFilesystem: z.boolean(),
	runAsUser: z.number().optional(),
	runAsGroup: z.number().optional(),
	runAsNonRoot: z.boolean().optional(),
	allowPrivilegeEscalation: z.boolean().optional(),
	privileged: z.boolean().optional(),
	cpuRequest: z.string().optional(),
	cpuLimit: z.string().optional(),
	memoryRequest: z.string().optional(),
	memoryLimit: z.string().optional(),
	endpoints: z.array(z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)),
});

const normalServiceSchema = serviceBase.extend({
	replicas: serviceBase.shape.replicas.default(1),
	file: serviceBase.shape.file.default("kubeconfig"),
	port: serviceBase.shape.port.default(3000),
	env: serviceBase.shape.env.default({}),
	readOnlyRootFilesystem:
		serviceBase.shape.readOnlyRootFilesystem.default(false),
	endpoints: serviceBase.shape.endpoints.default([]),
});

export type NormalDeployService = z.infer<typeof normalServiceSchema>;

const extendsServiceSchema = serviceBase.partial().extend({
	extends: z.string(),
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

const loginPromises = new Map<string, Promise<void>>();

const isDockerLoggedIn = async (hostname: string) => {
	const configPath = path.join(os.homedir(), ".docker", "config.json");
	try {
		const config = await Bun.file(configPath).json();
		const normalized = hostname === "docker.io" ? "index.docker.io" : hostname;
		return Object.keys(config?.auths ?? {}).some((h) => h.includes(normalized));
	} catch {
		return false;
	}
};

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

	const targetService =
		"extends" in targetServiceRaw
			? extendsServiceToNormal(targetServiceRaw, services, nextVisited)
			: structuredClone(targetServiceRaw);

	for (const [key, value] of Object.entries(service)) {
		if (key === "extends") continue;
		if (key === "env") {
			targetService.env = { ...targetService.env, ...service.env };
			continue;
		}
		if (value !== undefined) {
			// @ts-expect-error
			targetService[key] = value;
		}
	}

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
			const { hostname, username, password } = registry;
			if (!loginPromises.has(hostname)) {
				loginPromises.set(
					hostname,
					(async () => {
						if (await isDockerLoggedIn(hostname)) {
							console.log(`✅ Already logged in to ${hostname}`);
							return;
						}
						console.log(`🔑 Logging in to ${hostname}...`);
						await Bun.$`echo ${password} | docker login --username ${username} --password-stdin ${hostname}`;
						console.log(`... ✅ Logged in to ${hostname}`);
					})(),
				);
			}
			await loginPromises.get(hostname);

			const imageFullName = `${registry.hostname}/${image.repository}/${image.imageName}:${image.tag}`;

			console.log(`🔨 Building ${imageFullName}...`);
			const buildArgs = Object.entries(image.buildArgs).map(
				([key, value]) => `--build-arg=${key}=${value}`,
			);
			const targetArg = image.target ? [`--target=${image.target}`] : [];
			const buildContext = path.resolve(cwd, image.context);
			const dockerfilePath = path.resolve(cwd, image.dockerfile);
			await Bun.$`docker build --pull --push --tag=${imageFullName} ${targetArg} --file=${dockerfilePath} ${buildArgs} .`.cwd(
				buildContext,
			);
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
