import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import {
	analyzeDisk,
	cleanupTargets,
	type DiskOptions,
	dirSizeBytes,
	logCleanupStep,
	logCleanupSummary,
	sharedCleanupTargets,
	type WindowsBase,
} from "../diskCommon";
import { commandExists } from "../helpers";

type ResolvedWindowsTarget = {
	name: string;
	base: WindowsBase;
	path: string;
	description: string;
};

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

export const commandDiskWindows = async (options: DiskOptions) => {
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
	const dryRun = Boolean(options.dryRun);

	const getFullPath = (base: WindowsBase, relativePath: string): string => {
		const baseDir =
			base === "userprofile"
				? userProfile
				: base === "localappdata"
					? localAppData
					: base === "appdata"
						? appData
						: temp;
		return relativePath ? join(baseDir, relativePath) : baseDir;
	};

	console.log(
		`🪟 Windows Target Environment: ${
			isWslMode ? "[WSL -> /mnt/c]" : "[Native Windows]"
		}`,
	);
	console.log(`   UserProfile: ${userProfile}`);

	if (shouldClean) {
		console.log(
			dryRun
				? "\n🔍 [DRY-RUN] Previewing Windows cleanup targets..."
				: "\n🧹 Cleaning up Windows caches and reclaimable space...",
		);

		console.log("\n=== Target Windows Cleanup Directories ===");
		const targets: ResolvedWindowsTarget[] = sharedCleanupTargets
			.filter((t) => t.windows !== undefined)
			.map((t) => ({
				name: t.name,
				base: t.windows?.base ?? "userprofile",
				path: getFullPath(
					t.windows?.base ?? "userprofile",
					t.windows?.path ?? "",
				),
				description: t.description,
			}));
		const totalBytes = await cleanupTargets(targets, dryRun, (target) =>
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
			await logCleanupStep("Go Build & Mod Cache", "go clean", goCache, dryRun);
			if (!dryRun) {
				await rm(goCache, { recursive: true, force: true }).catch(() => {});
			}
		}

		// Empty Windows Recycle Bin if powershell/cmd is available
		if (await commandExists("powershell.exe")) {
			await logCleanupStep(
				"Windows Recycle Bin",
				"clean",
				"Clear-RecycleBin",
				dryRun,
				() =>
					$`powershell.exe -NoProfile -NonInteractive -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"`.nothrow(),
			);
		}

		logCleanupSummary(dryRun, totalBytes, "x disk-windows");
		return;
	}

	console.log(`\n🔍 Analyzing Windows disk space for "${userProfile}"...`);

	await analyzeDisk(userProfile, {
		top: topCount,
		extraDirs: [localAppData],
		limitBreakdown: true,
	});

	console.log(
		"\n💡 Tip: Run `x disk-windows --dry-run` to preview cleanup or `x disk-windows --clean` to automatically reclaim space.",
	);
};
