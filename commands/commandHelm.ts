import { $ } from "bun";
import { c, die, ensureCommand, pad, stripAnsi } from "../utils/helpers";
import { kubectlContext, printContextBanner } from "../utils/kubeCommon";

type HelmRelease = {
	name: string;
	namespace: string;
	revision: string;
	updated: string;
	status: string;
	chart: string;
	app_version: string;
};

type HelmSearchItem = {
	name: string;
	version: string;
	app_version: string;
	description?: string;
};

type CheckStatus = "pending" | "running" | "success" | "error" | "skipped";

const formatStatus = (status: CheckStatus): string => {
	switch (status) {
		case "pending":
			return `${c.gray}⏳ pending${c.reset}`;
		case "running":
			return `${c.yellow}🔄 checking...${c.reset}`;
		case "success":
			return `${c.green}✅ pass${c.reset}`;
		case "error":
			return `${c.red}❌ fail${c.reset}`;
		case "skipped":
			return `${c.gray}⏭️  skipped${c.reset}`;
	}
};

type ReleaseState = {
	name: string;
	namespace: string;
	currentChart: string;
	currentVersion: string;
	targetChart: string;
	targetVersion: string;
	clientDryRun: CheckStatus;
	clientError?: string;
	serverDryRun: CheckStatus;
	serverError?: string;
	upgradeStatus: CheckStatus;
	upgradeError?: string;
};

type HelmOptions = {
	upgrade?: boolean;
	all?: boolean;
};

export const commandHelm = async (
	releasesFilter: string[],
	options: HelmOptions,
) => {
	await ensureCommand("helm", "❌ helm command not found in PATH");

	const context = await kubectlContext();

	printContextBanner("☸️  Helm Chart Manager", context);

	const [, releasesJson] = await Promise.all([
		$`helm repo update`
			.quiet()
			.nothrow()
			.catch(() => null),
		$`helm list -A -o json`.text().catch(() => "[]"),
	]);

	let releases: HelmRelease[] = [];
	try {
		releases = JSON.parse(releasesJson);
	} catch {
		die("❌ Failed to parse helm releases output");
	}

	if (!releases || releases.length === 0) {
		console.log(`ℹ️  No Helm releases found in current context (${context}).`);
		return;
	}

	if (releasesFilter && releasesFilter.length > 0) {
		releases = releases.filter(
			(r) =>
				releasesFilter.includes(r.name) ||
				releasesFilter.includes(`${r.namespace}/${r.name}`),
		);
		if (releases.length === 0) {
			console.log(
				`ℹ️  No matching releases found for filter: ${releasesFilter.join(
					", ",
				)}`,
			);
			return;
		}
	}

	const rows: ReleaseState[] = [];
	for (const rel of releases) {
		const chartRaw = rel.chart;
		const match = chartRaw.match(/^(.*?)-(v?[0-9].*)$/);
		const baseChart = match?.[1] ? match[1] : chartRaw;
		const currentVer = match?.[2] ? match[2] : "";

		rows.push({
			name: rel.name,
			namespace: rel.namespace,
			currentChart: chartRaw,
			currentVersion: currentVer,
			targetChart: baseChart,
			targetVersion: "...",
			clientDryRun: "pending",
			serverDryRun: "pending",
			upgradeStatus: "pending",
		});
	}

	console.log(`${c.yellow}🔍 Checking charts asynchronously...${c.reset}\n`);

	const shouldUpgradeAll = Boolean(options.all);
	const shouldUpgrade = Boolean(options.upgrade) || shouldUpgradeAll;

	const colWidths = {
		name: 18,
		namespace: 16,
		chart: 24,
		target: 28,
		client: 12,
		server: 12,
		status: 16,
	};

	const header = [
		pad(`${c.bold}RELEASE${c.reset}`, colWidths.name),
		pad(`${c.bold}NAMESPACE${c.reset}`, colWidths.namespace),
		pad(`${c.bold}CURRENT CHART${c.reset}`, colWidths.chart),
		pad(`${c.bold}TARGET (REPO)${c.reset}`, colWidths.target),
		pad(`${c.bold}CLIENT DRY${c.reset}`, colWidths.client),
		pad(`${c.bold}SERVER DRY${c.reset}`, colWidths.server),
		pad(`${c.bold}UPGRADE${c.reset}`, colWidths.status),
	].join(" ");

	type StepKey = "clientDryRun" | "serverDryRun" | "upgradeStatus";
	const errorKey: Record<
		StepKey,
		"clientError" | "serverError" | "upgradeError"
	> = {
		clientDryRun: "clientError",
		serverDryRun: "serverError",
		upgradeStatus: "upgradeError",
	};

	/** Run one `helm upgrade` phase (dry-run or real), recording status on `row`. */
	const runStep = async (
		row: ReleaseState,
		key: StepKey,
		extraArgs: string[],
	): Promise<boolean> => {
		row[key] = "running";
		const res =
			await $`helm upgrade ${row.name} ${row.targetChart} -n ${row.namespace} --reuse-values ${extraArgs}`
				.quiet()
				.nothrow();
		if (res.exitCode === 0) {
			row[key] = "success";
			return true;
		}
		row[key] = "error";
		row[errorKey[key]] =
			res.stderr.toString().trim() || res.stdout.toString().trim();
		return false;
	};

	const processRelease = async (row: ReleaseState) => {
		const baseChart = row.targetChart;

		// 1. Resolve upstream target chart
		try {
			const searchOut = await $`helm search repo ${baseChart} -o json`
				.text()
				.catch(() => "[]");
			const searchResults: HelmSearchItem[] = JSON.parse(searchOut);
			const matched =
				searchResults.find(
					(item) =>
						item.name === baseChart || item.name.endsWith(`/${baseChart}`),
				) ?? searchResults[0];

			if (matched) {
				row.targetChart = matched.name;
				row.targetVersion = matched.version;
			}
		} catch {
			// keep fallback
		}

		// 2. Client dry run (server dry run & upgrade are skipped on failure)
		if (!(await runStep(row, "clientDryRun", ["--dry-run=client"]))) {
			row.serverDryRun = "skipped";
			row.upgradeStatus = "skipped";
			return;
		}

		// 3. Server dry run (upgrade is skipped on failure)
		if (!(await runStep(row, "serverDryRun", ["--dry-run=server"]))) {
			row.upgradeStatus = "skipped";
			return;
		}

		// 4. Upgrade if requested
		if (shouldUpgrade) {
			await runStep(row, "upgradeStatus", ["--rollback-on-failure"]);
		}
	};

	await Promise.all(rows.map((r) => processRelease(r)));

	console.log(header);
	console.log(`${c.dim}${"─".repeat(stripAnsi(header).length)}${c.reset}`);

	for (const row of rows) {
		let upgradeDisplay = "";
		if (row.upgradeStatus === "success") {
			upgradeDisplay = `${c.green}🎉 Upgraded${c.reset}`;
		} else if (row.upgradeStatus === "error") {
			upgradeDisplay = `${c.red}❌ Failed${c.reset}`;
		} else if (row.upgradeStatus === "skipped") {
			upgradeDisplay = `${c.gray}⏭️  Skipped${c.reset}`;
		} else {
			const canUpgrade =
				row.clientDryRun === "success" && row.serverDryRun === "success";
			upgradeDisplay = canUpgrade
				? `${c.green}Ready${c.reset}`
				: `${c.red}Dry run failed${c.reset}`;
		}

		const targetDisplay =
			row.targetChart +
			(row.targetVersion && row.targetVersion !== "..."
				? ` (${row.targetVersion})`
				: "");

		const rowLine = [
			pad(row.name, colWidths.name),
			pad(row.namespace, colWidths.namespace),
			pad(row.currentChart, colWidths.chart),
			pad(targetDisplay, colWidths.target),
			pad(formatStatus(row.clientDryRun), colWidths.client),
			pad(formatStatus(row.serverDryRun), colWidths.server),
			pad(upgradeDisplay, colWidths.status),
		].join(" ");

		console.log(rowLine);

		if (row.clientError || row.serverError || row.upgradeError) {
			const err = row.upgradeError || row.serverError || row.clientError || "";
			const firstErrLine = err.split("\n").filter(Boolean)[0] || "";
			console.log(`  ${c.red}↳ Error: ${firstErrLine.slice(0, 120)}${c.reset}`);
		}
	}

	console.log();

	if (!shouldUpgrade) {
		const readyCount = rows.filter(
			(r) => r.clientDryRun === "success" && r.serverDryRun === "success",
		).length;
		if (readyCount > 0) {
			console.log(
				`${c.dim}Tip: Run ${c.cyan}x helm --upgrade <release-name>${c.reset}${c.dim} or ${c.cyan}x helm -u -a${c.reset}${c.dim} to upgrade all ready charts.${c.reset}`,
			);
		}
	}
};
