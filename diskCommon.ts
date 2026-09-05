import { $ } from "bun";
import { formatBytes } from "./helpers";

/** A directory that `x disk` / `x disk-windows` can size and remove. */
export type CleanupTarget = {
	name: string;
	path: string;
	description: string;
};

/** Size of a directory in bytes (0 when missing or unreadable). */
export const dirSizeBytes = async (path: string): Promise<number> => {
	const out = await $`du -sk ${path} 2>/dev/null`.quiet().nothrow().text();
	const kb = Number.parseInt(out.split(/\s+/)[0] ?? "0", 10);
	return Number.isNaN(kb) ? 0 : kb * 1024;
};

/** Log each non-empty target with its size, removing it unless `dryRun`. Returns total reclaimable bytes. */
export const cleanupTargets = async <T extends CleanupTarget>(
	targets: readonly T[],
	dryRun: boolean,
	remove: (target: T) => Promise<unknown>,
): Promise<number> => {
	let totalBytes = 0;
	for (const target of targets) {
		const bytes = await dirSizeBytes(target.path);
		if (bytes <= 0) continue;
		totalBytes += bytes;
		console.log(
			`  • ${target.name.padEnd(26)} [${formatBytes(bytes).padEnd(
				8,
			)}]: ${target.path}`,
		);
		if (!dryRun) await remove(target);
	}
	return totalBytes;
};

export const logCleanupSummary = (
	dryRun: boolean,
	totalBytes: number,
	command: string,
) => {
	const summary = formatBytes(totalBytes);
	if (dryRun) {
		console.log(
			`\n✨ Dry-run complete. Potential space to reclaim: ~${summary}`,
		);
		console.log(`👉 Run \`${command} --clean\` to execute the cleanup.`);
	} else {
		console.log(`\n🎉 Cleanup complete! Reclaimed up to ~${summary}.`);
	}
};

/** Print the shared disk-analysis report: filesystem, breakdown, hidden dirs, largest files. */
export const analyzeDisk = async (
	root: string,
	options: {
		top?: number;
		extraDirs?: string[];
		limitBreakdown?: boolean;
	} = {},
) => {
	const topCount = options.top ?? 15;
	const extraDirs = options.extraDirs ?? [];
	const breakdownLimit = options.limitBreakdown ? " | tail -n 15" : "";

	console.log("\n=== 1. Filesystem Overview ===");
	const df = await $`df -h ${root}`.quiet().nothrow().text();
	console.log(df.trim() || "Drive overview unavailable.");

	console.log(`\n=== 2. Directory Breakdown in ${root} ===`);
	const duCmd = `du -hd 1 ${root} 2>/dev/null | sort -h${breakdownLimit}`;
	const duOut = await $`bash -c ${duCmd}`.quiet().nothrow().text();
	console.log(duOut.trim() || "No directories found / permission denied.");

	console.log(`\n=== 3. Top Hidden/Config Dirs in ${root} ===`);
	const hiddenDirs = [`${root}/.*`, ...extraDirs].join(" ");
	const duHiddenCmd = `du -hd 1 ${hiddenDirs} 2>/dev/null | sort -h | tail -n 15`;
	const duHiddenOut = await $`bash -c ${duHiddenCmd}`.quiet().nothrow().text();
	console.log(duHiddenOut.trim() || "None");

	console.log(`\n=== 4. Top ${topCount} Largest Files (>50M) in ${root} ===`);
	const findFilesCmd = `find ${root} -xdev -type f -size +50M -exec ls -lh {} + 2>/dev/null | awk '{ print $5, $9 }' | sort -hr | head -n ${topCount}`;
	const filesOut = await $`bash -c ${findFilesCmd}`.quiet().nothrow().text();
	console.log(filesOut.trim() || "No files > 50M found.");
};
