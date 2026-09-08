import { $ } from "bun";
import { die, ensureCommand, mapConcurrent } from "../utils/helpers";

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

const processPr = async (pr: PullRequest): Promise<string> => {
	const url = pr.url ?? "";
	const repo = pr.repository?.nameWithOwner ?? "";
	const num = pr.number ?? "";
	const title = pr.title ?? "";
	const author = (pr.author?.login ?? "").toLowerCase();

	if (author.includes("renovate")) {
		const { ok, stderr } = await closePr(url);
		return ok
			? `[RENOVATE CLOSED] ${repo}#${num}: ${title}`
			: `[RENOVATE FAILED CLOSE] ${repo}#${num} (${stderr}): ${title}`;
	}

	if (author.includes("dependabot")) {
		for (const flag of ["--squash", "--merge", "--rebase"]) {
			const res = await $`gh pr merge ${url} ${flag} --delete-branch --admin`
				.quiet()
				.nothrow();
			if (res.exitCode === 0) {
				return `[DEPENDABOT MERGED] ${repo}#${num} (${flag}): ${title}`;
			}
		}
		const { ok, stderr } = await closePr(url);
		return ok
			? `[DEPENDABOT CLOSED] ${repo}#${num} (Unmergeable): ${title}`
			: `[DEPENDABOT FAILED CLOSE] ${repo}#${num} (${stderr}): ${title}`;
	}

	return `[SKIPPED OTHER AUTHOR (${author})] ${repo}#${num}: ${title}`;
};

export const commandPrs = async (options: {
	owner?: string;
	concurrency?: number;
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
	console.log(`=== Starting PR Processor for owner: '${owner}' ===`);

	const prs = await fetchOpenPrs(owner);
	if (!prs || prs.length === 0) {
		console.log("No open PRs found.");
		return;
	}

	console.log(
		`\nFound ${prs.length} open PRs. Processing concurrently (workers=${maxWorkers})...`,
	);

	await mapConcurrent(prs, maxWorkers, async (pr) => {
		try {
			const result = await processPr(pr);
			console.log(`  ${result}`);
		} catch (e) {
			console.error(`  [ERROR] ${e}`);
		}
	});
	console.log("All PRs processed.");
};
