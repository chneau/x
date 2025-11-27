import { App, Chart, Duration } from "cdk8s";
import {
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
		resources: {},
		securityContext: { readOnlyRootFilesystem: service.readOnlyRootFilesystem },
		startup: Probe.fromTcpSocket({
			periodSeconds: Duration.seconds(1),
			failureThreshold: 30,
		}),
	});
	const _service = deployment.exposeViaService({ name: image.imageName });

	createIngresses(chart, _service, service.endpoints);

	return app.synthYaml();
};
