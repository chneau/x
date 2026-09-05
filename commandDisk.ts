import { $ } from "bun";
import {
	analyzeDisk,
	type CleanupTarget,
	cleanupTargets,
	dirSizeBytes,
	logCleanupSummary,
} from "./diskCommon";
import { commandExists, formatBytes } from "./helpers";
import { commandDiskWindows } from "./windows/commandDiskWindows";

type DiskOptions = {
	clean?: boolean;
	dryRun?: boolean;
	top?: number;
};

const getCleanupTargets = (home: string): CleanupTarget[] => [
	{
		name: "Bun Package Cache",
		path: `${home}/.bun/install/cache`,
		description: "Downloaded bun package tarballs and cache",
	},
	{
		name: "Bun Global node_modules",
		path: `${home}/.bun/install/global/node_modules`,
		description: "Installed global node modules",
	},
	{
		name: "UV Python Cache",
		path: `${home}/.cache/uv`,
		description: "UV Python package wheel cache",
	},
	{
		name: "Puppeteer Cache",
		path: `${home}/.cache/puppeteer`,
		description: "Cached chromium / browser downloads",
	},
	{
		name: "NPM Cache",
		path: `${home}/.npm/_cacache`,
		description: "NPM package download cache",
	},
	{
		name: "NPM NPX Cache",
		path: `${home}/.npm/_npx`,
		description: "Temporary binaries executed via npx",
	},
	{
		name: "NuGet Global Packages",
		path: `${home}/.nuget/packages`,
		description: "Cached .NET nuget packages",
	},
	{
		name: "NuGet v3 HTTP Cache",
		path: `${home}/.local/share/NuGet/v3-cache`,
		description: "NuGet HTTP response cache",
	},
	{
		name: "Trash",
		path: `${home}/.local/share/Trash`,
		description: "Desktop and shell trash files",
	},
	{
		name: "Heavy Pipx Venvs",
		path: `${home}/.local/share/pipx/venvs/headroom-ai`,
		description: "Pipx virtualenv with CUDA/PyTorch binaries",
	},
	{
		name: "Meteor Packages",
		path: `${home}/.meteor`,
		description: "Meteor framework packages and bundle caches",
	},
	{
		name: "Gradle Caches",
		path: `${home}/.gradle/caches`,
		description: "Gradle build dependency cache",
	},
	{
		name: "Gradle Wrapper Dists",
		path: `${home}/.gradle/wrapper/dists`,
		description: "Downloaded Gradle binaries",
	},
	{
		name: ".NET Tool Store",
		path: `${home}/.dotnet/tools/.store`,
		description: ".NET global tool downloads",
	},
	{
		name: "Homebrew Bottle Cache",
		path: `${home}/.cache/Homebrew`,
		description: "Cached Homebrew downloads and bottle tarballs",
	},
	{
		name: "Goimports / Gopls Cache",
		path: `${home}/.cache/goimports`,
		description: "Go tooling and language server index cache",
	},
	{
		name: "Pip Wheel Cache",
		path: `${home}/.cache/pip`,
		description: "Cached Python wheel packages",
	},
	{
		name: "Node-Gyp Build Cache",
		path: `${home}/.cache/node-gyp`,
		description: "Cached node-gyp native build headers",
	},
	{
		name: "Playwright Browser Binaries",
		path: `${home}/.cache/ms-playwright`,
		description: "Playwright headless browser downloads",
	},
	{
		name: "Playwright Go Cache",
		path: `${home}/.cache/ms-playwright-go`,
		description: "Playwright Go driver browser downloads",
	},
	{
		name: "Cypress Browser Cache",
		path: `${home}/.cache/Cypress`,
		description: "Cypress testing browser binaries",
	},
	{
		name: "Yarn Cache",
		path: `${home}/.cache/yarn`,
		description: "Yarn package cache",
	},
	{
		name: "Cargo Registry Cache",
		path: `${home}/.cargo/registry/cache`,
		description: "Cached Rust crate downloads (.crate files)",
	},
	{
		name: "Cargo Git DB",
		path: `${home}/.cargo/git/db`,
		description: "Cached git dependencies for Cargo",
	},
	{
		name: "pnpm Store",
		path: `${home}/.local/share/pnpm/store`,
		description: "Global pnpm content-addressable package store",
	},
	{
		name: "VS Code Server Binaries",
		path: `${home}/.vscode-server/bin`,
		description: "Outdated remote VS Code server versions",
	},
	{
		name: "VS Code Extension Caches",
		path: `${home}/.vscode-server/data/CachedExtensionVSIXs`,
		description: "Cached VSIX extension files",
	},
	{
		name: "VS Code Server Logs",
		path: `${home}/.vscode-server/data/logs`,
		description: "Old VS Code remote session logs",
	},
];

export const commandDisk = async (options: DiskOptions) => {
	if (process.platform === "win32") {
		await commandDiskWindows(options);
		return;
	}

	const home = Bun.env.HOME || "/home/c";
	const topCount = options.top || 15;
	const shouldClean = options.clean || options.dryRun;

	if (shouldClean) {
		console.log(
			options.dryRun
				? "🔍 [DRY-RUN] Previewing cleanup targets..."
				: "🧹 Cleaning up caches and reclaimable space...",
		);

		console.log("\n=== Target Cleanup Directories ===");
		const targets = getCleanupTargets(home);
		const totalFoundBytes = await cleanupTargets(
			targets,
			Boolean(options.dryRun),
			(target) => $`rm -rf ${target.path}`.nothrow(),
		);

		// Go cache cleaning
		if (await commandExists("go")) {
			const goCache = (
				await $`go env GOCACHE 2>/dev/null`.quiet().nothrow().text()
			).trim();
			const goModCache = (
				await $`go env GOMODCACHE 2>/dev/null`.quiet().nothrow().text()
			).trim();
			const goBytes =
				(goCache ? await dirSizeBytes(goCache) : 0) +
				(goModCache ? await dirSizeBytes(goModCache) : 0);
			if (goBytes > 0) {
				console.log(
					`  • ${"Go Build & Mod Cache".padEnd(
						26,
					)} [${formatBytes(goBytes).padEnd(8)}]: go clean`,
				);
				if (!options.dryRun) {
					await $`go clean -cache -modcache`.nothrow();
				}
			}
		}

		// Homebrew cache and old formula prune
		if (await commandExists("brew")) {
			console.log(
				`  • ${"Homebrew Cleanup".padEnd(
					26,
				)} [${"prune".padEnd(8)}]: brew cleanup -s --prune=all`,
			);
			if (!options.dryRun) {
				await $`brew cleanup -s --prune=all`.quiet().nothrow();
			}
		}

		// Docker system prune (all unused images + volumes)
		if (await commandExists("docker")) {
			console.log(
				`  • ${"Docker System Prune".padEnd(
					26,
				)} [${"prune".padEnd(8)}]: docker system prune -af --volumes`,
			);
			if (!options.dryRun) {
				await $`docker system prune -af --volumes`.quiet().nothrow();
			}
		}

		// Journalctl logs vacuum (systemd)
		if (await commandExists("journalctl")) {
			console.log(
				`  • ${"Systemd Journal Logs".padEnd(
					26,
				)} [${"vacuum".padEnd(8)}]: journalctl --vacuum-time=3d`,
			);
			if (!options.dryRun) {
				await $`journalctl --vacuum-time=3d 2>/dev/null`.quiet().nothrow();
			}
		}

		// Clean old temporary files in /tmp (files older than 2 days or bun/npm build artifacts)
		const tmpBytes = await dirSizeBytes("/tmp");
		if (tmpBytes > 1024 * 1024 * 50) {
			console.log(
				`  • ${"/tmp Temporary Files".padEnd(26)} [${formatBytes(
					tmpBytes,
				).padEnd(8)}]: /tmp build artifacts & stale files`,
			);
			if (!options.dryRun) {
				await $`find /tmp -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} + 2>/dev/null`.nothrow();
			}
		}

		logCleanupSummary(Boolean(options.dryRun), totalFoundBytes, "x disk");
		return;
	}

	console.log(`🔍 Analyzing disk space in "${home}"...`);

	await analyzeDisk(home, { top: topCount });

	// Cleanup hint
	console.log(
		"\n💡 Tip: Run `x disk --dry-run` to preview cleanup or `x disk --clean` to automatically reclaim space.",
	);
};
