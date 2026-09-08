import { $ } from "bun";
import {
	analyzeDisk,
	type CleanupTarget,
	cleanupTargets,
	dirSizeBytes,
	logCleanupStep,
	logCleanupSummary,
	unixCleanupTargets,
} from "./diskCommon";
import { commandExists, formatBytes } from "./helpers";
import { commandDiskWindows } from "./windows/commandDiskWindows";

type DiskOptions = {
	clean?: boolean;
	dryRun?: boolean;
	top?: number;
};

const goBytesReclaimable = async (): Promise<number> => {
	if (!(await commandExists("go"))) return 0;
	const goCache = (
		await $`go env GOCACHE 2>/dev/null`.quiet().nothrow().text()
	).trim();
	const goModCache = (
		await $`go env GOMODCACHE 2>/dev/null`.quiet().nothrow().text()
	).trim();
	return (
		(goCache ? await dirSizeBytes(goCache) : 0) +
		(goModCache ? await dirSizeBytes(goModCache) : 0)
	);
};

const commandDiskUnix = async (options: DiskOptions) => {
	const home = Bun.env.HOME || "/home/c";
	const topCount = options.top || 15;
	const dryRun = Boolean(options.dryRun);
	const shouldClean = options.clean || options.dryRun;

	if (shouldClean) {
		console.log(
			dryRun
				? "🔍 [DRY-RUN] Previewing cleanup targets..."
				: "🧹 Cleaning up caches and reclaimable space...",
		);

		console.log("\n=== Target Cleanup Directories ===");
		const targets: CleanupTarget[] = unixCleanupTargets(home);
		const totalFoundBytes = await cleanupTargets(targets, dryRun, (target) =>
			$`rm -rf ${target.path}`.nothrow(),
		);

		// Go cache cleaning
		const goBytes = await goBytesReclaimable();
		if (goBytes > 0) {
			await logCleanupStep(
				"Go Build & Mod Cache",
				formatBytes(goBytes),
				"go clean",
				dryRun,
				() => $`go clean -cache -modcache`.nothrow(),
			);
		}

		if (await commandExists("brew")) {
			await logCleanupStep(
				"Homebrew Cleanup",
				"prune",
				"brew cleanup -s --prune=all",
				dryRun,
				() => $`brew cleanup -s --prune=all`.quiet().nothrow(),
			);
		}

		if (await commandExists("docker")) {
			await logCleanupStep(
				"Docker System Prune",
				"prune",
				"docker system prune -af --volumes",
				dryRun,
				() => $`docker system prune -af --volumes`.quiet().nothrow(),
			);
		}

		if (await commandExists("journalctl")) {
			await logCleanupStep(
				"Systemd Journal Logs",
				"vacuum",
				"journalctl --vacuum-time=3d",
				dryRun,
				() => $`journalctl --vacuum-time=3d 2>/dev/null`.quiet().nothrow(),
			);
		}

		// Clean old temporary files in /tmp (files older than 2 days or bun/npm build artifacts)
		const tmpBytes = await dirSizeBytes("/tmp");
		if (tmpBytes > 1024 * 1024 * 50) {
			await logCleanupStep(
				"/tmp Temporary Files",
				formatBytes(tmpBytes),
				"/tmp build artifacts & stale files",
				dryRun,
			);
			if (!dryRun) {
				await $`find /tmp -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} + 2>/dev/null`.nothrow();
			}
		}

		logCleanupSummary(dryRun, totalFoundBytes, "x disk");
		return;
	}

	console.log(`🔍 Analyzing disk space in "${home}"...`);

	await analyzeDisk(home, { top: topCount });

	// Cleanup hint
	console.log(
		"\n💡 Tip: Run `x disk --dry-run` to preview cleanup or `x disk --clean` to automatically reclaim space.",
	);
};

export const commandDisk = async (options: DiskOptions) => {
	if (process.platform === "win32") {
		await commandDiskWindows(options);
		return;
	}
	await commandDiskUnix(options);
};
