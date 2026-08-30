import { $ } from "bun";
import { commandExists } from "./helpers";

type DiskOptions = {
	clean?: boolean;
	dryRun?: boolean;
	top?: number;
};

type CleanupTarget = {
	name: string;
	path: string;
	description: string;
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
	const home = Bun.env.HOME || "/home/c";
	const topCount = options.top || 15;
	const shouldClean = options.clean || options.dryRun;

	if (shouldClean) {
		console.log(
			options.dryRun
				? "🔍 [DRY-RUN] Previewing cleanup targets..."
				: "🧹 Cleaning up caches and reclaimable space...",
		);

		const targets = getCleanupTargets(home);
		let totalFoundBytes = 0;

		console.log("\n=== Target Cleanup Directories ===");
		for (const target of targets) {
			const res = await $`du -sk ${target.path} 2>/dev/null`
				.quiet()
				.nothrow()
				.text();
			const sizeStr = res.split(/\s+/)[0];
			const kb = Number.parseInt(sizeStr || "0", 10);
			if (kb > 0) {
				const humanRes = await $`du -sh ${target.path} 2>/dev/null`
					.quiet()
					.nothrow()
					.text();
				const humanSize = humanRes.split(/\s+/)[0] || `${kb}K`;
				totalFoundBytes += kb * 1024;
				console.log(
					`  • ${target.name.padEnd(26)} [${humanSize.padEnd(
						6,
					)}]: ${target.path}`,
				);

				if (!options.dryRun) {
					await $`rm -rf ${target.path}`.nothrow();
				}
			}
		}

		// Go cache cleaning
		if (await commandExists("go")) {
			const goCache = (
				await $`go env GOCACHE 2>/dev/null`.quiet().nothrow().text()
			).trim();
			const goModCache = (
				await $`go env GOMODCACHE 2>/dev/null`.quiet().nothrow().text()
			).trim();
			let goKb = 0;
			if (goCache) {
				const s = (
					await $`du -sk ${goCache} 2>/dev/null`.quiet().nothrow().text()
				).split(/\s+/)[0];
				goKb += Number.parseInt(s || "0", 10);
			}
			if (goModCache) {
				const s = (
					await $`du -sk ${goModCache} 2>/dev/null`.quiet().nothrow().text()
				).split(/\s+/)[0];
				goKb += Number.parseInt(s || "0", 10);
			}

			if (goKb > 0) {
				const mb = (goKb / 1024).toFixed(1);
				console.log(
					`  • ${"Go Build & Mod Cache".padEnd(26)} [${(`${mb}M`).padEnd(
						6,
					)}]: go clean`,
				);
				if (!options.dryRun) {
					await $`go clean -cache -modcache`.nothrow();
				}
			}
		}

		const totalMb = (totalFoundBytes / (1024 * 1024)).toFixed(2);
		const totalGb = (totalFoundBytes / (1024 * 1024 * 1024)).toFixed(2);
		const summarySize =
			totalFoundBytes > 1024 * 1024 * 1024 ? `${totalGb} GB` : `${totalMb} MB`;

		if (options.dryRun) {
			console.log(
				`\n✨ Dry-run complete. Potential space to reclaim: ~${summarySize}`,
			);
			console.log("👉 Run `x disk --clean` to execute the cleanup.");
		} else {
			console.log(`\n🎉 Cleanup complete! Reclaimed up to ~${summarySize}.`);
		}
		return;
	}

	console.log(`🔍 Analyzing disk space in "${home}"...`);

	// 1. Filesystem Overview
	console.log("\n=== 1. Filesystem Overview ===");
	try {
		const df = await $`df -h ${home}`.text();
		console.log(df.trim());
	} catch {
		console.log("Could not run df on home directory.");
	}

	// 2. High-level Breakdown in Home Directory
	console.log(`\n=== 2. Directory Breakdown in ${home} ===`);
	try {
		const duCmd = `du -hd 1 ${home} 2>/dev/null | sort -h`;
		const duOut = await $`bash -c ${duCmd}`.text();
		console.log(duOut.trim() || "No directories found / permission denied.");
	} catch {
		console.log("Failed to inspect directory breakdown.");
	}

	// 3. Top Hidden Directories/Caches in Home
	console.log(`\n=== 3. Top Hidden/Config Dirs in ${home} ===`);
	try {
		const duHiddenCmd = `du -hd 1 ${home}/.* 2>/dev/null | sort -h | tail -n 15`;
		const duHiddenOut = await $`bash -c ${duHiddenCmd}`.text();
		console.log(duHiddenOut.trim() || "None");
	} catch {
		console.log("Failed to inspect hidden directories.");
	}

	// 4. Largest Files in Home
	console.log(`\n=== 4. Top ${topCount} Largest Files (>50M) in ${home} ===`);
	try {
		const findFilesCmd = `find ${home} -xdev -type f -size +50M -exec ls -lh {} + 2>/dev/null | awk '{ print $5, $9 }' | sort -hr | head -n ${topCount}`;
		const filesOut = await $`bash -c ${findFilesCmd}`.text();
		console.log(filesOut.trim() || "No files > 50M found.");
	} catch {
		console.log("Failed to search large files.");
	}

	// 5. Cleanup hint
	console.log(
		"\n💡 Tip: Run `x disk --dry-run` to preview cleanup or `x disk --clean` to automatically reclaim space.",
	);
};
