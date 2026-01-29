import { App, Chart, Duration, Size } from "cdk8s";
import {
	Cpu,
	Deployment,
	EnvValue,
	Ingress,
	IngressBackend,
	type ISecret,
	Namespace,
	Probe,
	Secret,
	type Service,
} from "cdk8s-plus-33";
import type {
	DeployImage,
	DeployRegistry,
	NormalDeployService,
} from "./commandDeploy";

const parseCpu = (value: string): Cpu => {
	if (value.endsWith("m")) {
		return Cpu.millis(Number.parseInt(value.slice(0, -1), 10));
	}
	return Cpu.units(Number.parseFloat(value));
};

const parseSize = (value: string): Size => {
	const match = value.match(/^(\d+)([a-zA-Z]*)$/);
	if (!match || match[1] === undefined || match[2] === undefined) {
		throw new Error(`Invalid size: ${value}`);
	}
	const amount = Number.parseInt(match[1], 10);
	const unit = match[2];
	switch (unit) {
		case "Ki":
			return Size.kibibytes(amount);
		case "Mi":
			return Size.mebibytes(amount);
		case "Gi":
			return Size.gibibytes(amount);
		case "Ti":
			return Size.tebibytes(amount);
		case "Pi":
			return Size.pebibyte(amount);
		default:
			return Size.mebibytes(amount);
	}
};

const createDockerConfigJson = (
	chart: Chart,
	registryHost: string,
	registryUsername: string,
	registryPassword: string,
) => {
	const auths = {
		[registryHost]: {
			username: registryUsername,
			password: registryPassword,
			auth: btoa(`${registryUsername}:${registryPassword}`),
		},
	};
	const jsonString = JSON.stringify({ auths }, null, 2);
	return new Secret(chart, "docker-secret", {
		stringData: {
			".dockerconfigjson": jsonString,
		},
		type: "kubernetes.io/dockerconfigjson",
	});
};

const envVarToCDK8S = (envVars: { [key: string]: string }) => {
	const result: { [key: string]: EnvValue } = {};
	for (const [key, value] of Object.entries(envVars)) {
		result[key] = EnvValue.fromValue(value);
	}
	return result;
};

const createIngresses = (chart: Chart, service: Service, hosts: string[]) => {
	for (const host of hosts) {
		const sanitizedHost = host.replace(/\.|:|\//g, "-");
		const ingress = new Ingress(chart, sanitizedHost, { className: "nginx" });
		ingress.addRules({
			backend: IngressBackend.fromService(service),
			host: host,
			path: "/",
		});
		ingress.addTls([
			{
				hosts: [host],
				secret: { name: sanitizedHost } as ISecret,
			},
		]);
		ingress.metadata.addAnnotation(
			"cert-manager.io/cluster-issuer",
			"letsencrypt",
		);
	}
};

type createDeploymentProps = {
	serviceAlias: string;
	registry: DeployRegistry;
	image: DeployImage;
	service: NormalDeployService;
};
export const createDeployment = async ({
	serviceAlias,
	registry,
	image,
	service,
}: createDeploymentProps) => {
	const app = new App({ outputFileExtension: ".yml" });

	const chart = new Chart(app, service.namespace, {
		namespace: service.namespace,
		disableResourceNameHashes: true,
	});

	new Namespace(chart, service.namespace);

	const deployment = new Deployment(chart, `d-${serviceAlias}`, {
		replicas: service.replicas,
		metadata: { name: image.imageName },
		terminationGracePeriod: Duration.seconds(0),
		dockerRegistryAuth:
			registry.username && registry.password
				? createDockerConfigJson(
						chart,
						registry.hostname,
						registry.username,
						registry.password,
					)
				: undefined,
	});

	const imageFullName = `${registry.hostname}/${image.repository}/${image.imageName}:${image.tag}`;

	deployment.addContainer({
		name: image.imageName,
		image: imageFullName,
		portNumber: service.port,
		envVariables: envVarToCDK8S({
			...service.env,
			DEPLOYMENT_DATE: new Date().toISOString(),
		}),
		resources: {
			cpu: {
				request: service.cpuRequest ? parseCpu(service.cpuRequest) : undefined,
				limit: service.cpuLimit ? parseCpu(service.cpuLimit) : undefined,
			},
			memory: {
				request: service.memoryRequest
					? parseSize(service.memoryRequest)
					: undefined,
				limit: service.memoryLimit ? parseSize(service.memoryLimit) : undefined,
			},
		},
		securityContext: {
			readOnlyRootFilesystem: service.readOnlyRootFilesystem,
			user: service.runAsUser,
			group: service.runAsGroup,
			ensureNonRoot: service.runAsNonRoot,
			allowPrivilegeEscalation: service.allowPrivilegeEscalation,
			privileged: service.privileged,
		},
		startup: Probe.fromTcpSocket({
			periodSeconds: Duration.seconds(1),
			failureThreshold: 30,
		}),
	});
	const _service = deployment.exposeViaService({ name: image.imageName });

	createIngresses(chart, _service, service.endpoints);

	return app.synthYaml();
};
