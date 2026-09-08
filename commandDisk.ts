import { $ } from "bun";
import {
	analyzeDisk,
	type CleanupTarget,
	cleanupTargets,
	type DiskOptions,
	dirSizeBytes,
	logCleanupStep,
	logCleanupSummary,
	unixCleanupTargets,
} from "./diskCommon";
import { commandExists, formatBytes } from "./helpers";
import { commandDiskWindows } from "./windows/commandDiskWindows";

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

type CleanupCommand = {
	name: string;
	detail: string;
	/** Static note; defaults to the measured size when `size` is provided. */
	note?: string;
	/** Skip the step entirely when this returns false. */
	exists?: () => Promise<boolean>;
	size?: () => Promise<number>;
	/** Skip unless `size()` reports at least this many bytes. */
	minBytes?: number;
	run?: () => Promise<unknown>;
};

/** Cleanup steps gated on a tool being present, applied uniformly. */
const cleanupCommands: CleanupCommand[] = [
	{
		name: "Go Build & Mod Cache",
		detail: "go clean",
		size: goBytesReclaimable,
		minBytes: 1,
		run: () => $`go clean -cache -modcache`.nothrow(),
	},
	{
		name: "Homebrew Cleanup",
		note: "prune",
		detail: "brew cleanup -s --prune=all",
		exists: () => commandExists("brew"),
		run: () => $`brew cleanup -s --prune=all`.quiet().nothrow(),
	},
	{
		name: "Docker System Prune",
		note: "prune",
		detail: "docker system prune -af --volumes",
		exists: () => commandExists("docker"),
		run: () => $`docker system prune -af --volumes`.quiet().nothrow(),
	},
	{
		name: "Systemd Journal Logs",
		note: "vacuum",
		detail: "journalctl --vacuum-time=3d",
		exists: () => commandExists("journalctl"),
		run: () => $`journalctl --vacuum-time=3d 2>/dev/null`.quiet().nothrow(),
	},
	{
		// Clean old temporary files in /tmp (files older than 2 days or bun/npm build artifacts)
		name: "/tmp Temporary Files",
		detail: "/tmp build artifacts & stale files",
		size: () => dirSizeBytes("/tmp"),
		minBytes: 1024 * 1024 * 50,
		run: () =>
			$`find /tmp -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} + 2>/dev/null`.nothrow(),
	},
];

const runCleanupCommands = async (dryRun: boolean) => {
	for (const step of cleanupCommands) {
		if (step.exists && !(await step.exists())) continue;
		const bytes = step.size ? await step.size() : 0;
		if (step.minBytes !== undefined && bytes < step.minBytes) continue;
		await logCleanupStep(
			step.name,
			step.note ?? formatBytes(bytes),
			step.detail,
			dryRun,
			step.run,
		);
	}
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

		await runCleanupCommands(dryRun);

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
