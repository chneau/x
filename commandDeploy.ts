import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const example = {
	registries: {
		harbor: {
			hostname: "harbor.example.com",
			username: "admin",
			password: "123",
		},
	},
	images: {
		image: {
			registry: "harbor",

			dockerfile: "Dockerfile",
			target: "final",
			context: ".",
			args: {
				ARG1: "value",
				ARG2: "1234",
			},

			repository: "repo",
			imageName: "image",
			tag: "latest",
		},
	},
	services: {
		service: {
			image: "image",
			replicas: 1,
			file: "kubeconfig",
			context: "ctx",
			namespace: "ns",
			port: 3000,
			startupProbe: "/",
			env: {
				ENV1: "1234",
				ENV2: "value",
			},
			endpoints: ["test.example.com"],
		},
	},
};

const exampleSchema = z.object({
	registries: z.record(
		z.object({
			hostname: z.string(),
			username: z.string(),
			password: z.string(),
		}),
	),
	images: z.record(
		z.object({
			registry: z.string(),
			dockerfile: z.string().default("Dockerfile"),
			target: z.string().default("final"),
			tag: z.string().default("latest"),
			args: z.record(z.string(), z.string()).optional(),
			context: z.string().default("."),
			repository: z.string(),
			imageName: z.string(),
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
			env: z.record(z.string(), z.string()).optional(),
			endpoints: z.array(z.string()),
		}),
	),
});

// objective is to handle most cases for web application with micro services
// most of the sensible defaults are used
// micro services are considered stateless
// image target allow multi stage build target
// image build args are ignored
// image pull secrets are automatically added to the deployment
// image container port is the one from service port and is used through the whole pipeline pod/deployment/service/ingress to 80/443
// deployment strategy is always rolling update
// deployment resources is not configurable
// deployment volumnes are not used as best practice
// deployment affinity is not used as best practice
// deployment tolerations is not used as best practice
// Service type is always ClusterIP because services are exposed through ingress
// Security context is no root and no read only FS
// Ingress endpoints are always domains or subdomains which allow and force less complex routing configuration
// this tool can be used to directly deploy a new version of a software from command line or CI/CD pipeline handling build, push, deploy, expose

// Example usage
const parsed = exampleSchema.parse(example);

console.log(parsed);
const jsonSchema = zodToJsonSchema(exampleSchema, "mySchema");

console.dir(jsonSchema, { depth: null });
