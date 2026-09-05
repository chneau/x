import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import {
	analyzeDisk,
	cleanupTargets,
	dirSizeBytes,
	logCleanupSummary,
} from "../diskCommon";
import { commandExists, formatBytes } from "../helpers";

type DiskWindowsOptions = {
	clean?: boolean;
	dryRun?: boolean;
	top?: number;
};

type WindowsCleanupTarget = {
	name: string;
	relativePath: string;
	base: "userprofile" | "localappdata" | "appdata" | "temp";
	description: string;
};

type ResolvedWindowsTarget = WindowsCleanupTarget & { path: string };

const WINDOWS_TARGETS: WindowsCleanupTarget[] = [
	{
		name: "Bun Package Cache",
		base: "userprofile",
		relativePath: ".bun/install/cache",
		description: "Downloaded bun package tarballs and cache",
	},
	{
		name: "Bun Global node_modules",
		base: "userprofile",
		relativePath: ".bun/install/global/node_modules",
		description: "Installed global node modules",
	},
	{
		name: "UV Python Cache",
		base: "localappdata",
		relativePath: "uv/cache",
		description: "UV Python package cache",
	},
	{
		name: "NPM Cache",
		base: "appdata",
		relativePath: "npm-cache",
		description: "NPM package download cache",
	},
	{
		name: "NPM NPX Cache",
		base: "localappdata",
		relativePath: "npm-cache/_npx",
		description: "Temporary binaries executed via npx",
	},
	{
		name: "NuGet Packages Cache",
		base: "userprofile",
		relativePath: ".nuget/packages",
		description: "Cached .NET nuget packages",
	},
	{
		name: "NuGet HTTP Cache",
		base: "localappdata",
		relativePath: "NuGet/v3-cache",
		description: "NuGet HTTP response cache",
	},
	{
		name: "Pip Cache",
		base: "localappdata",
		relativePath: "pip/cache",
		description: "Cached Python wheel packages",
	},
	{
		name: "Cargo Registry Cache",
		base: "userprofile",
		relativePath: ".cargo/registry/cache",
		description: "Cached Rust crate downloads (.crate files)",
	},
	{
		name: "Cargo Git DB",
		base: "userprofile",
		relativePath: ".cargo/git/db",
		description: "Cached git dependencies for Cargo",
	},
	{
		name: "pnpm Store",
		base: "localappdata",
		relativePath: "pnpm/store",
		description: "Global pnpm content-addressable package store",
	},
	{
		name: "Yarn Cache",
		base: "localappdata",
		relativePath: "Yarn/Cache",
		description: "Yarn package cache",
	},
	{
		name: "Cypress Cache",
		base: "localappdata",
		relativePath: "Cypress/Cache",
		description: "Cypress testing browser binaries",
	},
	{
		name: "Playwright Cache",
		base: "localappdata",
		relativePath: "ms-playwright",
		description: "Playwright headless browser downloads",
	},
	{
		name: "Puppeteer Cache",
		base: "localappdata",
		relativePath: "puppeteer",
		description: "Puppeteer browser downloads",
	},
	{
		name: "Gradle Caches",
		base: "userprofile",
		relativePath: ".gradle/caches",
		description: "Gradle build dependency cache",
	},
	{
		name: "Gradle Wrapper Dists",
		base: "userprofile",
		relativePath: ".gradle/wrapper/dists",
		description: "Downloaded Gradle binaries",
	},
	{
		name: ".NET Tool Store",
		base: "userprofile",
		relativePath: ".dotnet/tools/.store",
		description: ".NET global tool downloads",
	},
	{
		name: "Winget Package Cache",
		base: "localappdata",
		relativePath:
			"Packages/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe/LocalState/DiagOutputDir",
		description: "Winget diagnostic logs and package outputs",
	},
	{
		name: "Temp Files",
		base: "temp",
		relativePath: "",
		description: "Windows User Temp directory",
	},
];

const isWsl = async (): Promise<boolean> => {
	if (process.platform === "win32") return false;
	if (Bun.env.WSL_DISTRO_NAME) return true;
	try {
		const procVersion = await Bun.file("/proc/version").text();
		return procVersion.toLowerCase().includes("microsoft");
	} catch {
		return false;
	}
};

const toWslPath = async (winPath: string): Promise<string> => {
	const trimmed = winPath.trim().replace(/^"|"$/g, "");
	if (!trimmed) return "";
	if (await commandExists("wslpath")) {
		const res = await $`wslpath -u ${trimmed}`.quiet().nothrow().text();
		if (res.trim()) return res.trim();
	}
	// Fallback conversion for standard drive letters: C:\Users\... -> /mnt/c/Users/...
	const match = trimmed.match(/^([a-zA-Z]):\\(.*)$/);
	if (match) {
		const drive = match[1]?.toLowerCase();
		const rest = match[2]?.replace(/\\/g, "/");
		return `/mnt/${drive}/${rest}`;
	}
	return trimmed;
};

type WindowsDirs = {
	userProfile: string;
	localAppData: string;
	appData: string;
	temp: string;
	isWslMode: boolean;
};

const resolveWindowsDirs = async (): Promise<WindowsDirs | null> => {
	const inWsl = await isWsl();

	if (process.platform === "win32") {
		const userProfile = Bun.env.USERPROFILE || "C:\\Users\\Default";
		const localAppData =
			Bun.env.LOCALAPPDATA || `${userProfile}\\AppData\\Local`;
		const appData = Bun.env.APPDATA || `${userProfile}\\AppData\\Roaming`;
		const temp = Bun.env.TEMP || `${localAppData}\\Temp`;
		return {
			userProfile,
			localAppData,
			appData,
			temp,
			isWslMode: false,
		};
	}

	if (inWsl) {
		// Try resolving via cmd.exe first (very fast in WSL)
		try {
			const cmdOut =
				await $`cmd.exe /c "echo %USERPROFILE%^|%LOCALAPPDATA%^|%APPDATA%^|%TEMP%"`
					.quiet()
					.nothrow()
					.text();
			const parts = cmdOut.trim().split("|");
			if (parts.length >= 4 && parts[0]?.includes("\\")) {
				const [winUserProfile, winLocalApp, winApp, winTemp] = parts;
				const [userProfile, localAppData, appData, temp] = await Promise.all([
					toWslPath(winUserProfile || "C:\\Users\\Default"),
					toWslPath(winLocalApp || "C:\\Users\\Default\\AppData\\Local"),
					toWslPath(winApp || "C:\\Users\\Default\\AppData\\Roaming"),
					toWslPath(winTemp || "C:\\Users\\Default\\AppData\\Local\\Temp"),
				]);
				return {
					userProfile,
					localAppData,
					appData,
					temp,
					isWslMode: true,
				};
			}
		} catch {}

		// Fallback scanning /mnt/c/Users
		const mntUsers = "/mnt/c/Users";
		try {
			const entries = await readdir(mntUsers, { withFileTypes: true });
			const userCandidates = entries
				.filter((e) => e.isDirectory())
				.map((e) => e.name)
				.filter(
					(name) =>
						![
							"All Users",
							"Default",
							"Default User",
							"Public",
							"desktop.ini",
						].includes(name),
				);

			const currentLinuxUser = Bun.env.USER || "c";
			const matchedUser =
				userCandidates.find(
					(u) => u.toLowerCase() === currentLinuxUser.toLowerCase(),
				) ||
				userCandidates[0] ||
				"c";

			const userProfile = `${mntUsers}/${matchedUser}`;
			const localAppData = `${userProfile}/AppData/Local`;
			const appData = `${userProfile}/AppData/Roaming`;
			const temp = `${localAppData}/Temp`;
			return {
				userProfile,
				localAppData,
				appData,
				temp,
				isWslMode: true,
			};
		} catch {}
	}

	return null;
};

export const commandDiskWindows = async (options: DiskWindowsOptions) => {
	const dirs = await resolveWindowsDirs();

	if (!dirs) {
		console.error(
			"❌ Could not detect Windows filesystem. Ensure you are running on Windows or inside WSL with /mnt/c mounted.",
		);
		return;
	}

	const { userProfile, localAppData, appData, temp, isWslMode } = dirs;
	const topCount = options.top || 15;
	const shouldClean = options.clean || options.dryRun;

	const getFullPath = (target: WindowsCleanupTarget): string => {
		let baseDir = userProfile;
		if (target.base === "localappdata") baseDir = localAppData;
		if (target.base === "appdata") baseDir = appData;
		if (target.base === "temp") baseDir = temp;
		return target.relativePath ? join(baseDir, target.relativePath) : baseDir;
	};

	console.log(
		`🪟 Windows Target Environment: ${
			isWslMode ? "[WSL -> /mnt/c]" : "[Native Windows]"
		}`,
	);
	console.log(`   UserProfile: ${userProfile}`);

	if (shouldClean) {
		console.log(
			options.dryRun
				? "\n🔍 [DRY-RUN] Previewing Windows cleanup targets..."
				: "\n🧹 Cleaning up Windows caches and reclaimable space...",
		);

		console.log("\n=== Target Windows Cleanup Directories ===");
		const targets: ResolvedWindowsTarget[] = WINDOWS_TARGETS.map((target) => ({
			...target,
			path: getFullPath(target),
		}));
		const totalBytes = await cleanupTargets(
			targets,
			Boolean(options.dryRun),
			(target) =>
				target.base === "temp"
					? $`find ${target.path} -mindepth 1 -maxdepth 2 -mtime +2 -exec rm -rf {} + 2>/dev/null`.nothrow()
					: rm(target.path, { recursive: true, force: true }).catch(() => {}),
		);

		// Go cache on Windows drive
		const goCache = join(localAppData, "go-build");
		const goModCache = join(userProfile, "go/pkg/mod");
		const goBytes =
			((await Bun.file(goCache)
				.exists()
				.catch(() => false))
				? await dirSizeBytes(goCache)
				: 0) +
			((await Bun.file(goModCache)
				.exists()
				.catch(() => false))
				? await dirSizeBytes(goModCache)
				: 0);
		if (goBytes > 0) {
			console.log(
				`  • ${"Go Build & Mod Cache".padEnd(
					26,
				)} [${formatBytes(goBytes).padEnd(8)}]: ${goCache}`,
			);
			if (!options.dryRun) {
				await rm(goCache, { recursive: true, force: true }).catch(() => {});
			}
		}

		// Empty Windows Recycle Bin if powershell/cmd is available
		if (await commandExists("powershell.exe")) {
			console.log(
				`  • ${"Windows Recycle Bin".padEnd(
					26,
				)} [${"clean".padEnd(8)}]: Clear-RecycleBin`,
			);
			if (!options.dryRun) {
				await $`powershell.exe -NoProfile -NonInteractive -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"`.nothrow();
			}
		}

		logCleanupSummary(Boolean(options.dryRun), totalBytes, "x disk-windows");
		return;
	}

	console.log(`\n🔍 Analyzing Windows disk space for "${userProfile}"...`);

	await analyzeDisk(userProfile, {
		top: topCount,
		extraDirs: [localAppData],
		limitBreakdown: true,
	});

	// Cleanup hint
	console.log(
		"\n💡 Tip: Run `x disk-windows --dry-run` to preview cleanup or `x disk-windows --clean` to automatically reclaim space.",
	);
};
