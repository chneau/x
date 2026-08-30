import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";
import PQueue from "p-queue";

type GitCleanOptions = {
	recursive?: number;
	concurrency?: number;
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
	const gitPath = join(dir, ".git");
	try {
		await stat(gitPath);
		return [dir];
	} catch {
		// Not a git repo at this directory level
	}

	if (currentDepth >= maxDepth) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

	const subdirs = entries
		.filter((entry) => entry.isDirectory())
		.filter((entry) => !entry.name.startsWith("."))
		.filter((entry) => entry.name !== "node_modules")
		.map((entry) => join(dir, entry.name));

	const results = await Promise.all(
		subdirs.map((subdir) => findGitRepos(subdir, currentDepth + 1, maxDepth)),
	);

	return results.flat();
};

const cleanGitRepo = async (repoPath: string) => {
	console.log(`=== Cleaning ${resolve(repoPath)} ===`);
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
		console.log(`✅ Cleaned ${resolve(repoPath)}`);
	} catch (e) {
		console.error(`❌ Failed cleaning ${resolve(repoPath)}:`, e);
	}
};

export const commandGitclean = async (
	dir = ".",
	options: GitCleanOptions = {},
) => {
	const cwd = typeof dir === "string" && dir.trim().length > 0 ? dir : ".";
	const recursive = options.recursive ?? 1;
	const concurrency = options.concurrency ?? 10;

	const repos = await findGitRepos(cwd, 0, recursive);

	if (repos.length === 0) {
		console.log(`No git repositories found in '${cwd}' (depth: ${recursive}).`);
		return;
	}

	console.log(
		`Found ${repos.length} git repo(s). Cleaning with concurrency ${concurrency}...`,
	);

	const queue = new PQueue({ concurrency });
	await Promise.all(repos.map((repo) => queue.add(() => cleanGitRepo(repo))));

	console.log("🎉 Done cleaning all git repositories.");
};
