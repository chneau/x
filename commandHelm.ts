import { $ } from "bun";

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

// ANSI color helpers
const c = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
	magenta: "\x1b[35m",
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "");

const pad = (str: string, length: number) => {
	const visibleLength = stripAnsi(str).length;
	const padLength = Math.max(0, length - visibleLength);
	return str + " ".repeat(padLength);
};

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

type HelmOptions = {
	upgrade?: boolean;
	all?: boolean;
};

export const commandHelm = async (
	releasesFilter: string[],
	options: HelmOptions,
) => {
	const helmCheck = await $`which helm`.quiet().nothrow();
	if (helmCheck.exitCode !== 0) {
		console.error("❌ helm command not found in PATH");
		process.exit(1);
	}

	const context = (
		await $`kubectl config current-context`.text().catch(() => "unknown")
	).trim();

	console.log(
		`${c.bold}☸️  Helm Chart Manager [Context: ${c.cyan}${context}${c.reset}${c.bold}]${c.reset}\n`,
	);

	const [releasesJson] = await Promise.all([
		$`helm list -A -o json`.text().catch(() => "[]"),
		$`helm repo update`
			.quiet()
			.nothrow()
			.catch(() => null),
	]);

	let releases: HelmRelease[] = [];
	try {
		releases = JSON.parse(releasesJson);
	} catch {
		console.error("❌ Failed to parse helm releases output");
		process.exit(1);
	}

	if (!releases || releases.length === 0) {
		console.log(`ℹ️  No Helm releases found in current context (${context}).`);
		return;
	}

	// Filter releases if specified as positional arguments
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

	// Asynchronously process each release
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

		// 2. Client dry run
		row.clientDryRun = "running";
		const clientRes =
			await $`helm upgrade ${row.name} ${row.targetChart} -n ${row.namespace} --reuse-values --dry-run=client`
				.quiet()
				.nothrow();

		if (clientRes.exitCode === 0) {
			row.clientDryRun = "success";
		} else {
			row.clientDryRun = "error";
			row.clientError =
				clientRes.stderr.toString().trim() ||
				clientRes.stdout.toString().trim();
			row.serverDryRun = "skipped";
			row.upgradeStatus = "skipped";
			return;
		}

		// 3. Server dry run
		row.serverDryRun = "running";
		const serverRes =
			await $`helm upgrade ${row.name} ${row.targetChart} -n ${row.namespace} --reuse-values --dry-run=server`
				.quiet()
				.nothrow();

		if (serverRes.exitCode === 0) {
			row.serverDryRun = "success";
		} else {
			row.serverDryRun = "error";
			row.serverError =
				serverRes.stderr.toString().trim() ||
				serverRes.stdout.toString().trim();
			row.upgradeStatus = "skipped";
			return;
		}

		// 4. Upgrade if requested
		if (shouldUpgrade) {
			row.upgradeStatus = "running";
			const upgradeRes =
				await $`helm upgrade ${row.name} ${row.targetChart} -n ${row.namespace} --reuse-values --rollback-on-failure`
					.quiet()
					.nothrow();

			if (upgradeRes.exitCode === 0) {
				row.upgradeStatus = "success";
			} else {
				row.upgradeStatus = "error";
				row.upgradeError =
					upgradeRes.stderr.toString().trim() ||
					upgradeRes.stdout.toString().trim();
			}
		} else {
			row.upgradeStatus = "pending";
		}
	};

	await Promise.all(rows.map((r) => processRelease(r)));

	// Output clean result table
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
