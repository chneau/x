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
	registryHost: string;
	registryUsername: string;
	registryPassword: string;
	imageName: string;
	imageTag: string;
	kubePort: number;
	kubeEnv: {
		[key: string]: string;
	};
	kubeEndpoints: string[];
};
export const createDeployment = async ({
	registryHost,
	registryUsername,
	registryPassword,
	imageName,
	imageTag,
	kubePort,
	kubeEnv,
	kubeEndpoints,
}: createDeploynentProps) => {
	const app = new App({ outputFileExtension: ".yml" });

	const chart = new Chart(app, imageName, {
		namespace: imageName,
		disableResourceNameHashes: true,
	});

	new Namespace(chart, imageName);

	const dockerSecret = createDockerConfigJson(
		chart,
		registryHost,
		registryUsername,
		registryPassword,
	);

	const deployment = new Deployment(chart, "deployment", {
		replicas: 1,
		terminationGracePeriod: Duration.seconds(0),
		dockerRegistryAuth: dockerSecret,
	});

	const imageFullName = `${registryHost}/${imageName}:${imageTag}`;

	deployment.addContainer({
		name: imageName,
		image: imageFullName,
		portNumber: kubePort,
		envVariables: envVarToCDK8S(kubeEnv),
		resources: {},
		securityContext: { readOnlyRootFilesystem: false },
		startup: Probe.fromTcpSocket({ periodSeconds: Duration.seconds(1) }),
	});
	const service = deployment.exposeViaService({ name: imageName });

	createIngress(chart, service, kubeEndpoints);

	app.synth();

	return app;
};
