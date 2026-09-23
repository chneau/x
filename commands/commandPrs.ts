import { $ } from "bun";
import { c, die, ensureCommand, mapConcurrent } from "../utils/helpers";

type PullRequest = {
	number: number;
	title: string;
	url: string;
	repository?: {
		nameWithOwner?: string;
	};
	author?: {
		login?: string;
	};
};

const getGhUser = async (): Promise<string> => {
	try {
		const out = await $`gh api user --jq .login`.quiet().text();
		return out.trim();
	} catch {
		return "";
	}
};

const fetchOpenPrs = async (
	owner: string,
	limit = 200,
): Promise<PullRequest[]> => {
	try {
		const out =
			await $`gh search prs --owner ${owner} --state open --limit=${limit} --json number,title,repository,url,author`
				.quiet()
				.text();
		return JSON.parse(out) as PullRequest[];
	} catch (e) {
		console.error("Error fetching PRs:", e);
		return [];
	}
};

/** Close a PR (deleting its branch when possible), retrying without. */
const closePr = async (
	url: string,
): Promise<{ ok: boolean; stderr: string }> => {
	let res = await $`gh pr close ${url} --delete-branch`.quiet().nothrow();
	if (res.exitCode !== 0) {
		res = await $`gh pr close ${url}`.quiet().nothrow();
	}
	return {
		ok: res.exitCode === 0,
		stderr: res.stderr.toString().trim().slice(0, 60),
	};
};

const processPr = async (pr: PullRequest, dryRun = false): Promise<string> => {
	const url = pr.url ?? "";
	const repo = pr.repository?.nameWithOwner ?? "";
	const num = pr.number ?? "";
	const title = pr.title ?? "";
	const author = (pr.author?.login ?? "").toLowerCase();

	if (dryRun) {
		if (author.includes("renovate")) {
			return `${c.yellow}[DRY-RUN WOULD CLOSE]${c.reset} ${repo}#${num}: ${title}`;
		}
		if (author.includes("dependabot")) {
			return `${c.cyan}[DRY-RUN WOULD MERGE/CLOSE]${c.reset} ${repo}#${num}: ${title}`;
		}
		return `${c.gray}[SKIPPED OTHER AUTHOR (${author})]${c.reset} ${repo}#${num}: ${title}`;
	}

	if (author.includes("renovate")) {
		const { ok, stderr } = await closePr(url);
		return ok
			? `${c.green}[RENOVATE CLOSED]${c.reset} ${repo}#${num}: ${title}`
			: `${c.red}[RENOVATE FAILED CLOSE]${c.reset} ${repo}#${num} (${stderr}): ${title}`;
	}

	if (author.includes("dependabot")) {
		for (const flag of ["--squash", "--merge", "--rebase"]) {
			const res = await $`gh pr merge ${url} ${flag} --delete-branch --admin`
				.quiet()
				.nothrow();
			if (res.exitCode === 0) {
				return `${c.green}[DEPENDABOT MERGED]${c.reset} ${repo}#${num} (${flag}): ${title}`;
			}
		}
		const { ok, stderr } = await closePr(url);
		return ok
			? `${c.yellow}[DEPENDABOT CLOSED]${c.reset} ${repo}#${num} (Unmergeable): ${title}`
			: `${c.red}[DEPENDABOT FAILED CLOSE]${c.reset} ${repo}#${num} (${stderr}): ${title}`;
	}

	return `${c.gray}[SKIPPED OTHER AUTHOR (${author})]${c.reset} ${repo}#${num}: ${title}`;
};

export const commandPrs = async (options: {
	owner?: string;
	concurrency?: number;
	dryRun?: boolean;
}) => {
	await ensureCommand(
		"gh",
		"❌ 'gh' (GitHub CLI) is not installed or not in PATH.",
	);

	const owner = options.owner || (await getGhUser());
	if (!owner) {
		die(
			"❌ Could not determine GitHub owner. Please log in with `gh auth login` or specify --owner <user>.",
		);
	}

	const maxWorkers = options.concurrency ?? 10;
	const isDryRun = Boolean(options.dryRun);

	if (isDryRun) {
		console.log("🔍 Running in dry-run mode (no PRs will be merged or closed)");
	}

	console.log(`=== Starting PR Processor for owner: '${owner}' ===`);

	const prs = await fetchOpenPrs(owner);
	if (!prs || prs.length === 0) {
		console.log("No open PRs found.");
		return;
	}

	console.log(
		`\nFound ${prs.length} open PRs. ${
			isDryRun ? "Previewing" : "Processing"
		} concurrently (workers=${maxWorkers})...`,
	);

	await mapConcurrent(prs, maxWorkers, async (pr) => {
		try {
			const result = await processPr(pr, isDryRun);
			console.log(`  ${result}`);
		} catch (e) {
			console.error(`  [ERROR] ${e}`);
		}
	});
	console.log(isDryRun ? "All PRs previewed." : "All PRs processed.");
};
