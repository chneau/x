import { join } from "node:path";
import { $ } from "bun";
import { formatBytes } from "./helpers";

/** Options shared by `x disk` and `x disk-windows`. */
export type DiskOptions = {
	clean?: boolean;
	dryRun?: boolean;
	top?: number;
};

/** A directory that `x disk` / `x disk-windows` can size and remove. */
export type CleanupTarget = {
	name: string;
	path: string;
	description: string;
};

/** Base directory a Windows cleanup path resolves against. */
export type WindowsBase = "userprofile" | "localappdata" | "appdata" | "temp";

/**
 * Logical cleanup target shared by `x disk` and `x disk-windows`.
 * `unix` is relative to $HOME, `windows` relative to the matching Windows base
 * dir; a target is only listed on platforms where it has a path.
 */
type SharedTarget = {
	name: string;
	description: string;
	unix?: string;
	windows?: { base: WindowsBase; path: string };
};

export const sharedCleanupTargets: SharedTarget[] = [
	{
		name: "Bun Package Cache",
		unix: ".bun/install/cache",
		windows: { base: "userprofile", path: ".bun/install/cache" },
		description: "Downloaded bun package tarballs and cache",
	},
	{
		name: "Bun Global node_modules",
		unix: ".bun/install/global/node_modules",
		windows: { base: "userprofile", path: ".bun/install/global/node_modules" },
		description: "Installed global node modules",
	},
	{
		name: "UV Python Cache",
		unix: ".cache/uv",
		windows: { base: "localappdata", path: "uv/cache" },
		description: "UV Python package cache",
	},
	{
		name: "NPM Cache",
		unix: ".npm/_cacache",
		windows: { base: "appdata", path: "npm-cache" },
		description: "NPM package download cache",
	},
	{
		name: "NPM NPX Cache",
		unix: ".npm/_npx",
		windows: { base: "localappdata", path: "npm-cache/_npx" },
		description: "Temporary binaries executed via npx",
	},
	{
		name: "NuGet Global Packages",
		unix: ".nuget/packages",
		windows: { base: "userprofile", path: ".nuget/packages" },
		description: "Cached .NET nuget packages",
	},
	{
		name: "NuGet v3 HTTP Cache",
		unix: ".local/share/NuGet/v3-cache",
		windows: { base: "localappdata", path: "NuGet/v3-cache" },
		description: "NuGet HTTP response cache",
	},
	{
		name: "Puppeteer Cache",
		unix: ".cache/puppeteer",
		windows: { base: "localappdata", path: "puppeteer" },
		description: "Cached chromium / browser downloads",
	},
	{
		name: "Trash",
		unix: ".local/share/Trash",
		description: "Desktop and shell trash files",
	},
	{
		name: "Heavy Pipx Venvs",
		unix: ".local/share/pipx/venvs/headroom-ai",
		description: "Pipx virtualenv with CUDA/PyTorch binaries",
	},
	{
		name: "Meteor Packages",
		unix: ".meteor",
		description: "Meteor framework packages and bundle caches",
	},
	{
		name: "Gradle Caches",
		unix: ".gradle/caches",
		windows: { base: "userprofile", path: ".gradle/caches" },
		description: "Gradle build dependency cache",
	},
	{
		name: "Gradle Wrapper Dists",
		unix: ".gradle/wrapper/dists",
		windows: { base: "userprofile", path: ".gradle/wrapper/dists" },
		description: "Downloaded Gradle binaries",
	},
	{
		name: ".NET Tool Store",
		unix: ".dotnet/tools/.store",
		windows: { base: "userprofile", path: ".dotnet/tools/.store" },
		description: ".NET global tool downloads",
	},
	{
		name: "Homebrew Bottle Cache",
		unix: ".cache/Homebrew",
		description: "Cached Homebrew downloads and bottle tarballs",
	},
	{
		name: "Goimports / Gopls Cache",
		unix: ".cache/goimports",
		description: "Go tooling and language server index cache",
	},
	{
		name: "Pip Wheel Cache",
		unix: ".cache/pip",
		windows: { base: "localappdata", path: "pip/cache" },
		description: "Cached Python wheel packages",
	},
	{
		name: "Node-Gyp Build Cache",
		unix: ".cache/node-gyp",
		description: "Cached node-gyp native build headers",
	},
	{
		name: "Playwright Browser Binaries",
		unix: ".cache/ms-playwright",
		windows: { base: "localappdata", path: "ms-playwright" },
		description: "Playwright headless browser downloads",
	},
	{
		name: "Playwright Go Cache",
		unix: ".cache/ms-playwright-go",
		description: "Playwright Go driver browser downloads",
	},
	{
		name: "Cypress Browser Cache",
		unix: ".cache/Cypress",
		windows: { base: "localappdata", path: "Cypress/Cache" },
		description: "Cypress testing browser binaries",
	},
	{
		name: "Yarn Cache",
		unix: ".cache/yarn",
		windows: { base: "localappdata", path: "Yarn/Cache" },
		description: "Yarn package cache",
	},
	{
		name: "Cargo Registry Cache",
		unix: ".cargo/registry/cache",
		windows: { base: "userprofile", path: ".cargo/registry/cache" },
		description: "Cached Rust crate downloads (.crate files)",
	},
	{
		name: "Cargo Git DB",
		unix: ".cargo/git/db",
		windows: { base: "userprofile", path: ".cargo/git/db" },
		description: "Cached git dependencies for Cargo",
	},
	{
		name: "pnpm Store",
		unix: ".local/share/pnpm/store",
		windows: { base: "localappdata", path: "pnpm/store" },
		description: "Global pnpm content-addressable package store",
	},
	{
		name: "VS Code Server Binaries",
		unix: ".vscode-server/bin",
		description: "Outdated remote VS Code server versions",
	},
	{
		name: "VS Code Extension Caches",
		unix: ".vscode-server/data/CachedExtensionVSIXs",
		description: "Cached VSIX extension files",
	},
	{
		name: "VS Code Server Logs",
		unix: ".vscode-server/data/logs",
		description: "Old VS Code remote session logs",
	},
	{
		name: "Winget Package Cache",
		windows: {
			base: "localappdata",
			path: "Packages/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe/LocalState/DiagOutputDir",
		},
		description: "Winget diagnostic logs and package outputs",
	},
	{
		name: "Temp Files",
		windows: { base: "temp", path: "" },
		description: "Windows User Temp directory",
	},
];

/** `sharedCleanupTargets` resolved against a unix $HOME. */
export const unixCleanupTargets = (home: string): CleanupTarget[] =>
	sharedCleanupTargets
		.filter((t) => t.unix !== undefined)
		.map((t) => ({
			name: t.name,
			path: join(home, t.unix ?? ""),
			description: t.description,
		}));

/** Log a cleanup step, running its command unless `dryRun`. */
export const logCleanupStep = async (
	name: string,
	note: string,
	detail: string,
	dryRun: boolean,
	run?: () => Promise<unknown>,
) => {
	console.log(`  • ${name.padEnd(26)} [${note.padEnd(8)}]: ${detail}`);
	if (!dryRun && run) await run();
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
