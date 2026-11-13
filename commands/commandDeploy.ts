import { readdir } from "node:fs/promises";
import path from "node:path";
import { createDeployment } from "../utils/cdk8s";
import { c, envSubst } from "../utils/helpers";
import { $, Redacted } from "../utils/verboseShell";

export type DeployRegistry = {
  hostname: string;
  username?: string | null;
  password?: string | null;
};

export type DeployImage = {
  registry: string;
  dockerfile: string;
  target?: string;
  buildArgs: Record<string, string>;
  context: string;
  repository: string;
  imageName: string;
  tag: string;
};

export type NormalDeployService = {
  image: string;
  replicas: number;
  file: string;
  context: string;
  namespace: string;
  port: number;
  env: Record<string, string>;
  readOnlyRootFilesystem: boolean;
  runAsUser?: number;
  runAsGroup?: number;
  runAsNonRoot?: boolean;
  allowPrivilegeEscalation?: boolean;
  privileged?: boolean;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
  startupProbePeriodSeconds?: number;
  startupProbeFailureThreshold?: number;
  endpoints: string[];
  ingress: "nginx" | "traefik";
};

type ExtendsDeployService = Partial<NormalDeployService> & {
  extends: string;
};

type DeployService = NormalDeployService | ExtendsDeployService;

type Deploy = {
  $schema?: string;
  registries: Record<string, DeployRegistry>;
  images: Record<string, DeployImage>;
  services: Record<string, DeployService>;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const reqStr = (v: unknown, name: string): string => {
  if (typeof v !== "string") throw new Error(`${name} must be a string`);
  return v;
};

const optStr = (v: unknown, name: string): string | undefined => {
  if (v === undefined) return undefined;
  return reqStr(v, name);
};

const strRecord = (v: unknown, name: string): Record<string, string> => {
  if (v === undefined) return {};
  if (!isRecord(v)) throw new Error(`${name} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = reqStr(val, `${name}.${k}`);
  }
  return out;
};

const endpointRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const parseDeploy = (raw: unknown): Deploy => {
  if (!isRecord(raw)) throw new Error("Deploy config must be an object");
  const registriesRaw = raw.registries ?? {};
  if (!isRecord(registriesRaw)) {
    throw new Error("registries must be an object");
  }
  const registries: Record<string, DeployRegistry> = {};
  for (const [k, v] of Object.entries(registriesRaw)) {
    if (!isRecord(v)) throw new Error(`registries.${k} must be an object`);
    registries[k] = {
      hostname: reqStr(v.hostname, `registries.${k}.hostname`),
      username:
        v.username === null || v.username === undefined
          ? v.username
          : reqStr(v.username, `registries.${k}.username`),
      password:
        v.password === null || v.password === undefined
          ? v.password
          : reqStr(v.password, `registries.${k}.password`),
    };
  }

  if (!isRecord(raw.images)) throw new Error("images must be an object");
  const images: Record<string, DeployImage> = {};
  for (const [k, v] of Object.entries(raw.images)) {
    if (!isRecord(v)) throw new Error(`images.${k} must be an object`);
    images[k] = {
      registry: reqStr(v.registry, `images.${k}.registry`),
      dockerfile:
        optStr(v.dockerfile, `images.${k}.dockerfile`) ?? "Dockerfile",
      target: optStr(v.target, `images.${k}.target`),
      buildArgs: strRecord(v.buildArgs, `images.${k}.buildArgs`),
      context: optStr(v.context, `images.${k}.context`) ?? ".",
      repository: reqStr(v.repository, `images.${k}.repository`),
      imageName: reqStr(v.imageName, `images.${k}.imageName`),
      tag: optStr(v.tag, `images.${k}.tag`) ?? "latest",
    };
  }

  if (!isRecord(raw.services)) throw new Error("services must be an object");
  const services: Record<string, DeployService> = {};
  for (const [k, v] of Object.entries(raw.services)) {
    if (!isRecord(v)) throw new Error(`services.${k} must be an object`);
    if (typeof v.extends === "string") {
      services[k] = v as ExtendsDeployService;
      continue;
    }
    const port = v.port === undefined ? 3000 : v.port;
    if (typeof port !== "number" || port < 1 || port > 65535) {
      throw new Error(`services.${k}.port must be 1..65535`);
    }
    const endpointsRaw = v.endpoints ?? [];
    if (!Array.isArray(endpointsRaw)) {
      throw new Error(`services.${k}.endpoints must be an array`);
    }
    const endpoints = endpointsRaw.map((e, i) => {
      const s = reqStr(e, `services.${k}.endpoints[${i}]`);
      if (!endpointRegex.test(s)) {
        throw new Error(`services.${k}.endpoints[${i}] is invalid: ${s}`);
      }
      return s;
    });
    const ingress = v.ingress ?? "nginx";
    if (ingress !== "nginx" && ingress !== "traefik") {
      throw new Error(`services.${k}.ingress must be nginx or traefik`);
    }
    services[k] = {
      ...(v as Partial<NormalDeployService>),
      image: reqStr(v.image, `services.${k}.image`),
      replicas: typeof v.replicas === "number" ? v.replicas : 1,
      file: optStr(v.file, `services.${k}.file`) ?? "kubeconfig",
      context: reqStr(v.context, `services.${k}.context`),
      namespace: reqStr(v.namespace, `services.${k}.namespace`),
      port,
      env: strRecord(v.env, `services.${k}.env`),
      readOnlyRootFilesystem:
        typeof v.readOnlyRootFilesystem === "boolean"
          ? v.readOnlyRootFilesystem
          : false,
      endpoints,
      ingress,
    };
  }

  return {
    $schema: optStr(raw.$schema, "$schema"),
    registries,
    images,
    services,
  };
};

const loginPromises = new Map<string, Promise<void>>();

const isDockerLoggedIn = async (hostname: string) => {
  const configPath = path.join(
    Bun.env.HOME ?? Bun.env.USERPROFILE ?? "",
    ".docker",
    "config.json",
  );
  try {
    const config = await Bun.file(configPath).json();
    const normalized = hostname === "docker.io" ? "index.docker.io" : hostname;
    return Object.keys(config?.auths ?? {}).some((h) => h.includes(normalized));
  } catch {
    return false;
  }
};

type DeployOptions = {
  dryRun?: boolean;
  printYaml?: boolean;
};

export const commandDeploy = async (
  files: string[] = [],
  options: DeployOptions = {},
) => {
  const dryRun = Boolean(options.dryRun);
  const printYaml = Boolean(options.printYaml);

  const jsonFiles = files.filter((arg) => arg.endsWith(".json"));
  const filters = files.filter((arg) => !arg.endsWith(".json"));
  const isTargettingJsonFiles = jsonFiles.length > 0;
  if (jsonFiles.length === 0) {
    const entries = await readdir(".", { withFileTypes: true }).catch(() => []);
    const discoveredJson = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name);
    jsonFiles.push(...discoveredJson, ".deploy.json");
  }
  let isFound = false;
  let invalidCount = 0;
  const promises: Promise<unknown>[] = [];
  for (const jsonFile of jsonFiles) {
    const file = Bun.file(jsonFile);
    const rawStr = await file.text().catch(() => null);
    if (!rawStr) continue;
    let parsed: Deploy;
    try {
      parsed = parseDeploy(JSON.parse(envSubst(rawStr)));
    } catch (error) {
      if (isTargettingJsonFiles) {
        invalidCount += 1;
        console.error(
          `${c.red}❌ Invalid deploy config '${jsonFile}'${c.reset}`,
        );
        console.error(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
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
          dryRun,
          printYaml,
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
  if (invalidCount > 0) process.exitCode = 1;
  await Promise.all(promises);
};

const createTemplateDeploy = async () => {
  console.log("🕒 Creating .deploy.json template...");
  const template = parseDeploy({
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
        ingress: "nginx",
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
  console.log(
    "💡 Tip: Edit .deploy.json with your service and registry configuration, then run 'x deploy' again.",
  );
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
      (targetService as Record<string, unknown>)[key] = value;
    }
  }

  return targetService;
};

type DeployParams = {
  config: Deploy;
  allServices: Record<string, DeployService>;
  cwd: string;
  dryRun?: boolean;
  printYaml?: boolean;
};

const dockerLogin = (hostname: string, username: string, password: string) => {
  if (!loginPromises.has(hostname)) {
    loginPromises.set(
      hostname,
      (async () => {
        if (await isDockerLoggedIn(hostname)) {
          console.log(`✅ Already logged in to ${hostname}`);
          return;
        }
        console.log(`🔑 Logging in to ${hostname}...`);
        await $`echo ${new Redacted(
          password,
        )} | docker login --username ${username} --password-stdin ${hostname}`;
        console.log(`... ✅ Logged in to ${hostname}`);
      })(),
    );
  }
  return loginPromises.get(hostname);
};

const deploy = async ({
  config,
  cwd,
  allServices,
  dryRun = false,
  printYaml = false,
}: DeployParams) => {
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

    const imageFullName = `${registry.hostname}/${image.repository}/${image.imageName}:${image.tag}`;

    if (!dryRun) {
      if (registry.username && registry.password) {
        await dockerLogin(
          registry.hostname,
          registry.username,
          registry.password,
        );
      }
      console.log(`🔨 Building ${imageFullName}...`);
      const buildArgs = Object.entries(image.buildArgs).map(
        ([key, value]) => `--build-arg=${key}=${value}`,
      );
      const targetArg = image.target ? [`--target=${image.target}`] : [];
      const buildContext = path.resolve(cwd, image.context);
      const dockerfilePath = path.resolve(cwd, image.dockerfile);
      await $`docker build --pull --push --tag=${imageFullName} ${targetArg} --file=${dockerfilePath} ${buildArgs} .`.cwd(
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
      ingress: service.ingress,
    });
    console.log(`... ✅ Created deployment for ${serviceAlias}`);

    if (printYaml) {
      console.log(deploymentYaml);
    }

    if (dryRun) {
      console.log(`[dry-run] Skipping kubectl apply for ${serviceAlias}`);
      continue;
    }

    console.log(`🚀 Deploying ${serviceAlias}...`);
    const kubeEnv = {
      ...Bun.env,
      KUBECONFIG: path.join(cwd, service.file),
    };
    await $`echo ${deploymentYaml} | kubectl --context=${service.context} apply --filename=-`.env(
      kubeEnv,
    );
    console.log(`... ✅ Deployed ${serviceAlias}`);
  }
};
