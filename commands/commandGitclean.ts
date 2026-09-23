import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { c, mapConcurrent, subdirectories } from "../utils/helpers";

type GitCleanOptions = {
	recursive?: number;
	concurrency?: number;
	dryRun?: boolean;
};

const isGitRepo = async (dir: string): Promise<boolean> => {
	try {
		await stat(join(dir, ".git"));
		return true;
	} catch {
		return false;
	}
};

/**
 * Finds all git repositories recursively up to maxDepth.
 * maxDepth = 0 means only check targetDir.
 * If targetDir itself is a git repo, returns [targetDir].
 * When a directory contains a .git directory or file (submodule/worktree),
 * it is considered a git root and we don't recurse deeper into it.
 */
const findGitRepos = async (
	dir: string,
	currentDepth: number,
	maxDepth: number,
): Promise<string[]> => {
	if (await isGitRepo(dir)) {
		return [dir];
	}
	if (currentDepth >= maxDepth) {
		return [];
	}
	const results = await Promise.all(
		(await subdirectories(dir)).map((subdir) =>
			findGitRepos(subdir, currentDepth + 1, maxDepth),
		),
	);
	return results.flat();
};

const cleanGitRepo = async (repoPath: string, dryRun = false) => {
	const absPath = resolve(repoPath);
	if (dryRun) {
		const untracked = (
			await $`git -C ${repoPath} clean -ndx`.quiet().nothrow().text()
		).trim();
		if (untracked) {
			const count = untracked.split("\n").filter(Boolean).length;
			console.log(
				`🔍 [dry-run] ${absPath}: ${c.yellow}${count} untracked item(s) would be deleted${c.reset}`,
			);
		} else {
			console.log(
				`🔍 [dry-run] ${absPath}: ${c.dim}clean (would expire reflog, repack, prune)${c.reset}`,
			);
		}
		return;
	}

	console.log(`=== Cleaning ${absPath} ===`);
	try {
		await $`git -C ${repoPath} reflog expire --expire=now --all`
			.quiet()
			.nothrow();
		await $`git -C ${repoPath} repack -ad`.quiet().nothrow();
		await $`git -C ${repoPath} prune`.quiet().nothrow();
		await $`git -C ${repoPath} fetch --prune --prune-tags`.quiet().nothrow();
		await $`GIT_ASK_YESNO=false git -C ${repoPath} clean -ffdx`
			.quiet()
			.nothrow();
		console.log(`✅ Cleaned ${absPath}`);
	} catch (e) {
		console.error(`❌ Failed cleaning ${absPath}:`, e);
	}
};

export const commandGitclean = async (
	dir = ".",
	options: GitCleanOptions = {},
) => {
	const cwd = typeof dir === "string" && dir.trim().length > 0 ? dir : ".";
	const recursive = options.recursive ?? 1;
	const concurrency = options.concurrency ?? 10;
	const isDryRun = Boolean(options.dryRun);

	if (isDryRun) {
		console.log(
			"🔍 Running in dry-run mode (no files will be deleted, repos will not be repacked)",
		);
	}

	const repos = await findGitRepos(cwd, 0, recursive);

	if (repos.length === 0) {
		console.log(`No git repositories found in '${cwd}' (depth: ${recursive}).`);
		return;
	}

	console.log(
		`Found ${repos.length} git repo(s). ${
			isDryRun ? "Previewing" : "Cleaning"
		} with concurrency ${concurrency}...`,
	);

	await mapConcurrent(repos, concurrency, (r) => cleanGitRepo(r, isDryRun));

	console.log(
		isDryRun
			? "🎉 Done previewing git repositories."
			: "🎉 Done cleaning all git repositories.",
	);
};
