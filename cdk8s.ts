import { App, Chart, Duration } from "cdk8s";
import {
	Deployment,
	EnvValue,
	type ISecret,
	Ingress,
	IngressBackend,
	Namespace,
	Probe,
	Secret,
	type Service,
} from "cdk8s-plus-32";
import type {
	DeployImage,
	DeployRegistry,
	DeployService,
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

const createIngress = (chart: Chart, service: Service, hosts: string[]) => {
	const ingress = new Ingress(chart, "ingress", { className: "nginx" });
	for (const host of hosts) {
		ingress.addRules({
			backend: IngressBackend.fromService(service),
			host: host,
			path: "/",
		});
		ingress.addTls([
			{
				hosts: [host],
				secret: { name: host.replace(/\.|:|\//g, "-") } as ISecret,
			},
		]);
	}
	ingress.metadata.addAnnotation(
		"cert-manager.io/cluster-issuer",
		"letsencrypt",
	);
	return ingress;
};

type createDeploynentProps = {
	registry: DeployRegistry;
	image: DeployImage;
	service: DeployService;
};
export const createDeployment = async ({
	registry,
	image,
	service,
}: createDeploynentProps) => {
	const app = new App({ outputFileExtension: ".yml" });

	const chart = new Chart(app, service.namespace, {
		namespace: service.namespace,
		disableResourceNameHashes: true,
	});

	new Namespace(chart, service.namespace);

	const dockerSecret = createDockerConfigJson(
		chart,
		registry.hostname,
		registry.username,
		registry.password,
	);

	const deployment = new Deployment(chart, "deployment", {
		replicas: service.replicas,
		metadata: { name: image.imageName },
		terminationGracePeriod: Duration.seconds(0),
		dockerRegistryAuth: dockerSecret,
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
		startup: Probe.fromTcpSocket({ periodSeconds: Duration.seconds(1) }),
	});
	const _service = deployment.exposeViaService({ name: image.imageName });

	createIngress(chart, _service, service.endpoints);

	return app.synthYaml();
};
