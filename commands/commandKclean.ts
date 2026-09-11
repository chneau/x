import { $ } from "bun";
import { c, ensureCommand, mapConcurrent } from "../utils/helpers";
import {
	kubectlContext,
	kubectlContexts,
	printContextBanner,
} from "../utils/kubeCommon";

type KcleanOptions = {
	allNamespaces?: boolean;
	allContexts?: boolean;
	yes?: boolean;
};

type ObjectRef = {
	namespace: string;
	name: string;
};

type CleanEntry = {
	kind: string;
	plural: string;
	objects: ObjectRef[];
};

/** Subset of a kubectl `-o json` object we care about. */
type K8sObject = {
	spec?: { replicas?: number };
	metadata?: { name?: string; namespace?: string };
};

/** Runs a kubectl command and parses its `-o json` output (empty on failure). */
const getJson = async (
	parts: string[],
	context?: string,
): Promise<{ items: K8sObject[] }> => {
	try {
		const contextArgs = context ? ["--context", context] : [];
		const raw = await $`kubectl ${contextArgs} ${parts}`.quiet().text();
		return JSON.parse(raw) as { items: K8sObject[] };
	} catch {
		return { items: [] };
	}
};

const toRefs = (items: K8sObject[]): ObjectRef[] =>
	items
		.map((item) => ({
			namespace: item.metadata?.namespace ?? "",
			name: item.metadata?.name ?? "",
		}))
		.filter((ref) => ref.name.length > 0);

/** Zero-replica ReplicaSets across the requested namespace scope. */
const gatherReplicaSets = async (allNamespaces: boolean, context?: string) => {
	const json = await getJson(
		["get", "rs", ...(allNamespaces ? ["-A"] : []), "-o", "json"],
		context,
	);
	return toRefs(json.items.filter((item) => item.spec?.replicas === 0));
};

/** Pods in the given phase across the requested namespace scope. */
const gatherPods = async (
	allNamespaces: boolean,
	phase: string,
	context?: string,
) => {
	const json = await getJson(
		[
			"get",
			"pods",
			...(allNamespaces ? ["-A"] : []),
			"-o",
			"json",
			"--field-selector",
			`status.phase=${phase}`,
		],
		context,
	);
	return toRefs(json.items);
};

const buildEntries = async (
	allNamespaces: boolean,
	context?: string,
): Promise<CleanEntry[]> =>
	[
		{
			kind: "replicaset",
			plural: "ReplicaSets",
			objects: await gatherReplicaSets(allNamespaces, context),
		},
		{
			kind: "pod",
			plural: "Pods (Failed)",
			objects: await gatherPods(allNamespaces, "Failed", context),
		},
		{
			kind: "pod",
			plural: "Pods (Succeeded)",
			objects: await gatherPods(allNamespaces, "Succeeded", context),
		},
	].filter((entry) => entry.objects.length > 0);

const formatObjects = (objects: ObjectRef[]): string => {
	const showNs = new Set(objects.map((o) => o.namespace)).size > 1;
	return objects
		.map((o) => (showNs && o.namespace ? `${o.namespace}/${o.name}` : o.name))
		.join(", ");
};

const printPlan = (entries: CleanEntry[]) => {
	for (const entry of entries) {
		console.log(
			`${c.yellow}${entry.plural}${c.reset} (${entry.objects.length}):`,
		);
		console.log(`  ${c.dim}${formatObjects(entry.objects)}${c.reset}`);
	}
	const total = entries.reduce((sum, e) => sum + e.objects.length, 0);
	console.log(`\n${c.bold}${total}${c.reset} object(s) to delete.`);
};

const deleteObjects = async (
	entry: CleanEntry,
	context?: string,
): Promise<number> => {
	// Deletions must be scoped to a namespace, so group objects per namespace.
	const byNs = new Map<string, ObjectRef[]>();
	for (const obj of entry.objects) {
		const list = byNs.get(obj.namespace) ?? [];
		list.push(obj);
		byNs.set(obj.namespace, list);
	}

	const contextArgs = context ? ["--context", context] : [];

	const operations = [...byNs.entries()].map(
		([namespace, objects]) =>
			async () => {
				const names = objects.map((o) => o.name);
				try {
					if (namespace) {
						await $`kubectl ${contextArgs} delete ${entry.kind} ${names} -n ${namespace}`;
					} else {
						await $`kubectl ${contextArgs} delete ${entry.kind} ${names}`;
					}
				} catch {
					console.error(
						`${c.red}❌ Failed to delete ${entry.kind} in namespace '${
							namespace || "(default)"
						}'.${c.reset}`,
					);
				}
			},
	);

	await mapConcurrent(operations, 4, (fn) => fn());
	return entry.objects.length;
};

const cleanSingleContext = async ({
	context,
	allNamespaces,
	yes,
}: {
	context: string;
	allNamespaces: boolean;
	yes: boolean;
}): Promise<number> => {
	printContextBanner(
		"🧹 Kube Clean",
		context,
		allNamespaces ? "/ all namespaces" : "",
	);

	const entries = await buildEntries(allNamespaces, context);

	if (entries.length === 0) {
		console.log(
			"✅ Nothing to clean: no zero-replica ReplicaSets, failed, or succeeded Pods.\n",
		);
		return 0;
	}

	if (!yes) {
		console.log(`${c.dim}Dry run — nothing was deleted.${c.reset}\n`);
		printPlan(entries);
		console.log(
			`\n${c.dim}Re-run with ${c.cyan}--yes${c.reset}${c.dim} to actually delete.${c.reset}\n`,
		);
		return 0;
	}

	printPlan(entries);
	console.log();

	const deleted = await Promise.all(
		entries.map((e) => deleteObjects(e, context)),
	).then((counts) => counts.reduce((sum, n) => sum + n, 0));
	console.log(`\n🎉 Deleted ${deleted} object(s).\n`);
	return deleted;
};

export const commandKclean = async (options: KcleanOptions = {}) => {
	const allNamespaces = Boolean(options.allNamespaces);
	const allContexts = Boolean(options.allContexts);
	const yes = Boolean(options.yes);

	await ensureCommand("kubectl");

	if (allContexts) {
		const contexts = await kubectlContexts();
		if (contexts.length === 0) {
			console.log(`${c.yellow}⚠️ No kubectl contexts found.${c.reset}`);
			return;
		}

		let totalDeleted = 0;
		for (const context of contexts) {
			totalDeleted += await cleanSingleContext({
				context,
				allNamespaces,
				yes,
			});
		}

		if (yes) {
			console.log(
				`${c.bold}🎉 Total deleted across all contexts: ${totalDeleted} object(s).${c.reset}`,
			);
		}
		return;
	}

	const context = await kubectlContext();
	await cleanSingleContext({
		context,
		allNamespaces,
		yes,
	});
};
