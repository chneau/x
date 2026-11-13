import type {
  DeployImage,
  DeployRegistry,
  NormalDeployService,
} from "../commands/commandDeploy";

const createTraefikIngressRoutesYaml = (
  serviceName: string,
  hosts: string[],
  namespace: string,
  port: number,
): string => {
  const yamls = hosts.map((host) => {
    const sanitizedHost = host.replaceAll(/[.:/]/g, "-");
    return `apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: ${sanitizedHost}
  namespace: ${namespace}
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(\`${host}\`)
      kind: Rule
      services:
        - name: ${serviceName}
          port: ${port}
  tls:
    certResolver: le`;
  });

  return yamls.join("\n---\n");
};

type createDeploymentProps = {
  serviceAlias: string;
  registry: DeployRegistry;
  image: DeployImage;
  service: NormalDeployService;
  ingress: string;
};

export const createDeployment = async ({
  serviceAlias,
  registry,
  image,
  service,
  ingress,
}: createDeploymentProps) => {
  const docs: unknown[] = [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: service.namespace },
    },
  ];

  const secretName = `${service.namespace}-docker-secret`;
  const hasAuth = Boolean(registry.username && registry.password);
  if (hasAuth && registry.username && registry.password) {
    const auths = {
      [registry.hostname]: {
        username: registry.username,
        password: registry.password,
        auth: btoa(`${registry.username}:${registry.password}`),
      },
    };
    docs.push({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName, namespace: service.namespace },
      type: "kubernetes.io/dockerconfigjson",
      stringData: { ".dockerconfigjson": JSON.stringify({ auths }, null, 2) },
    });
  }

  const imageFullName = `${registry.hostname}/${image.repository}/${image.imageName}:${image.tag}`;
  const labels = { app: `d-${serviceAlias}` };
  const env = Object.entries({
    ...service.env,
    DEPLOYMENT_DATE: new Date().toISOString(),
  }).map(([name, value]) => ({ name, value }));

  const requests: Record<string, string> = {};
  const limits: Record<string, string> = {};
  if (service.cpuRequest) requests.cpu = service.cpuRequest;
  if (service.memoryRequest) requests.memory = service.memoryRequest;
  if (service.cpuLimit) limits.cpu = service.cpuLimit;
  if (service.memoryLimit) limits.memory = service.memoryLimit;

  const securityContext: Record<string, unknown> = {
    readOnlyRootFilesystem: service.readOnlyRootFilesystem,
  };
  if (service.runAsUser !== undefined) {
    securityContext.runAsUser = service.runAsUser;
  }
  if (service.runAsGroup !== undefined) {
    securityContext.runAsGroup = service.runAsGroup;
  }
  if (service.runAsNonRoot !== undefined) {
    securityContext.runAsNonRoot = service.runAsNonRoot;
  }
  if (service.allowPrivilegeEscalation !== undefined) {
    securityContext.allowPrivilegeEscalation = service.allowPrivilegeEscalation;
  }
  if (service.privileged !== undefined) {
    securityContext.privileged = service.privileged;
  }

  docs.push({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: image.imageName, namespace: service.namespace },
    spec: {
      replicas: service.replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          terminationGracePeriodSeconds: 0,
          ...(hasAuth ? { imagePullSecrets: [{ name: secretName }] } : {}),
          containers: [
            {
              name: image.imageName,
              image: imageFullName,
              ports: [{ containerPort: service.port }],
              env,
              ...(Object.keys(requests).length > 0 ||
              Object.keys(limits).length > 0
                ? {
                    resources: {
                      ...(Object.keys(requests).length > 0 ? { requests } : {}),
                      ...(Object.keys(limits).length > 0 ? { limits } : {}),
                    },
                  }
                : {}),
              securityContext,
              startupProbe: {
                tcpSocket: { port: service.port },
                periodSeconds: service.startupProbePeriodSeconds ?? 1,
                failureThreshold: service.startupProbeFailureThreshold ?? 30,
              },
            },
          ],
        },
      },
    },
  });

  docs.push({
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: image.imageName, namespace: service.namespace },
    spec: {
      selector: labels,
      ports: [{ port: service.port, targetPort: service.port }],
    },
  });

  if (ingress !== "traefik") {
    for (const host of service.endpoints) {
      const sanitizedHost = host.replaceAll(/[.:/]/g, "-");
      docs.push({
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: sanitizedHost,
          namespace: service.namespace,
          annotations: {
            "cert-manager.io/cluster-issuer": "letsencrypt",
          },
        },
        spec: {
          ingressClassName: "nginx",
          tls: [{ hosts: [host], secretName: sanitizedHost }],
          rules: [
            {
              host,
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                      service: {
                        name: image.imageName,
                        port: { number: service.port },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      });
    }
  }

  let out = docs.map((d) => JSON.stringify(d, null, 2)).join("\n---\n");
  if (ingress === "traefik" && service.endpoints.length > 0) {
    const traefikYaml = createTraefikIngressRoutesYaml(
      image.imageName,
      service.endpoints,
      service.namespace,
      service.port,
    );
    out = `${out}\n---\n${traefikYaml}`;
  }
  return out;
};
