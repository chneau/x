import { readdir } from "node:fs/promises";
import { cpus } from "node:os";
import type { ZodAny, z } from "zod";
import { mapConcurrent, walkDirectories } from "./helpers";

type CommandOptions = {
	recursive?: number;
	dryRun?: boolean;
};

export const commandPurify = async (
	dir = ".",
	options: CommandOptions = {},
) => {
	const cwd = typeof dir === "string" && dir.trim().length > 0 ? dir : ".";
	const recursive = options.recursive ?? 0;
	const isDryRun = Boolean(options.dryRun);
	if (isDryRun) {
		console.log(
			"🔍 Running in dry-run mode (no files or scripts will be modified/executed)",
		);
	}
	const directories = await walkDirectories(cwd, recursive);
	await mapConcurrent(directories, Math.max(cpus().length * 2, 2), (d) =>
		purify(d, isDryRun).catch(console.error),
	);
};

const isCSharpProject = async (dir: string): Promise<boolean> => {
	try {
		const files = await readdir(dir, { withFileTypes: true });
		return files.some(
			(file) =>
				file.isFile() &&
				(file.name.endsWith(".csproj") || file.name.endsWith(".sln")),
		);
	} catch {
		return false;
	}
};

const purify = async (dir: string, dryRun = false) => {
	console.log(`🚀 Managing files in ${dir}`);
	await removeFileIfExists(dir, "package-lock.json", dryRun).catch(
		console.error,
	);
	await removeFileIfExists(dir, "yarn.lock", dryRun).catch(console.error);
	const isCSharp = await isCSharpProject(dir);
	const packageJsonExists = await managePackagejson(
		dir,
		isCSharp,
		dryRun,
	).catch(console.error);
	const tsconfigExists = await manageTsconfig(dir, dryRun).catch(console.error);
	await manageGitignore(dir, packageJsonExists ?? false, dryRun).catch(
		console.error,
	);
	if (dryRun) {
		console.log(`🔍 [dry-run] Would run checks/upgrades for ${dir}`);
		console.log(`🎉 Done previewing files in ${dir}`);
		return;
	}
	if (packageJsonExists) {
		console.log("🚀 Updating everything!");
		await Bun.$`timeout 20s bun run --cwd=${dir} upgrade`
			.nothrow()
			.catch(console.error);
	}
	if (tsconfigExists) {
		console.log("🚀 Checking and linting!");
		await Bun.$`timeout 6s bun run --cwd=${dir} check`
			.nothrow()
			.catch(console.error);
	} else if (isCSharp && packageJsonExists) {
		console.log("🚀 Checking C# project!");
		await Bun.$`timeout 60s bun run --cwd=${dir} check`
			.nothrow()
			.catch(console.error);
	}
	console.log("🎉 Done with all files");
};

const removeFileIfExists = async (
	dir: string,
	filename: string,
	dryRun = false,
): Promise<boolean> => {
	const path = `${dir}/${filename}`;
	const file = Bun.file(path);
	if (!(await file.exists())) return false;
	if (dryRun) {
		console.log(`🔍 [dry-run] Would remove ${path}`);
		return true;
	}
	await Bun.$`rm -f ${path}`.nothrow();
	console.log(`✅ Done with ${path}`);
	return true;
};

const manageGitignore = async (
	dir: string,
	isBunProject: boolean,
	dryRun = false,
): Promise<boolean> => {
	const filename = `${dir}/.gitignore`;
	const file = Bun.file(filename);
	if (!(await file.exists())) return false;
	const gitignore = await file.text();
	const lines = new Set(
		gitignore
			.split("\n")
			.map((x) => x.trim())
			.filter(Boolean),
	);
	if (lines.size > 10) console.error(`👁️ ${filename} is too long`);
	if (isBunProject) {
		lines.add("node_modules");
	}
	if (dryRun) {
		console.log(`🔍 [dry-run] Would update ${filename}`);
		return true;
	}
	await Bun.write(file, [...lines].join("\n"));
	console.log(`✅ Done with ${filename}`);
	return true;
};

/** Serialize `data`, write it, then let biome reformat the file. */
const writeManagedJson = async (
	file: ReturnType<typeof Bun.file>,
	data: unknown,
	dryRun: boolean,
) => {
	const filename = file.name ?? "";
	if (dryRun) {
		console.log(`🔍 [dry-run] Would update ${filename}`);
		return;
	}
	await Bun.write(file, `${JSON.stringify(data, null, 2)}\n`);
	await Bun.$`biome check --write --unsafe ${filename}`.nothrow();
	console.log(`✅ Done with ${filename}`);
};

const manageTsconfig = async (
	dir: string,
	dryRun = false,
): Promise<boolean> => {
	const filename = `${dir}/tsconfig.json`;
	const file = Bun.file(filename);
	if (!(await file.exists())) return false;
	const tsconfig = Bun.JSONC.parse(await file.text()) as z.infer<ZodAny>;
	if (!tsconfig.compilerOptions) return false;
	const expected = {
		noUnusedLocals: true,
		noUnusedParameters: true,
		noUncheckedIndexedAccess: true,
		noFallthroughCasesInSwitch: true,
		noEmit: true,
		strict: true,
		skipLibCheck: true,
		incremental: true,
		tsBuildInfoFile: "./node_modules/.tmp/tsconfig.tsbuildinfo",
		resolveJsonModule: true,
		esModuleInterop: true,
	};
	for (const [key, value] of Object.entries(expected)) {
		if (tsconfig.compilerOptions[key] === value) continue;
		tsconfig.compilerOptions[key] = value;
	}
	await writeManagedJson(file, tsconfig, dryRun);
	return true;
};

type PackageJson = {
	scripts?: Record<string, string>;
	prettier?: unknown;
	dependencies?: unknown;
	devDependencies?: unknown;
};

const managePackagejson = async (
	dir: string,
	isCSharp: boolean,
	dryRun = false,
): Promise<boolean> => {
	const filename = `${dir}/package.json`;
	const file = Bun.file(filename);
	let pkgJson: PackageJson;
	if (!(await file.exists())) {
		if (isCSharp) {
			pkgJson = { scripts: {} };
		} else {
			return false;
		}
	} else {
		pkgJson = (await file.json()) as PackageJson;
		pkgJson.scripts ??= {};
	}
	if (!isCSharp) {
		const hasDependencies = pkgJson.dependencies || pkgJson.devDependencies;
		if (!hasDependencies) return false;
	}
	const expected = isCSharp
		? {
				check:
					"bun run --sequential --no-exit-on-error check:deno check:biome check:dotnet check:csharpier",
				"check:deno": "deno fmt --use-tabs --quiet",
				"check:biome": "biome format --write .",
				"check:dotnet":
					"dotnet format --severity info --no-restore --exclude-diagnostics IDE0130 CA1869",
				"check:csharpier": "dotnet csharpier format .",
				upgrade: "dotnet tool update --all; dotnet outdated --upgrade",
				"upgrade-minor": "bun run upgrade --version-lock=Minor",
				"upgrade-major": "bun run upgrade --version-lock=Major",
				all: "bun run upgrade; bun run check",
			}
		: {
				upgrade: "bun update --latest",
				check:
					"bun run --sequential --no-exit-on-error check:clean check:deno check:oxlint check:biome check:export lint",
				"check:clean": "rm -rf dist out build",
				"check:deno": "deno fmt --use-tabs --quiet",
				"check:oxlint":
					"oxlint --fix-dangerously --fix-suggestions --fix --quiet",
				"check:biome": "timeout 3s biome check --write --unsafe .",
				"check:export": "ts-unused-exports tsconfig.json",
				lint: "tsc --noEmit",
				all: "bun run --sequential --no-exit-on-error upgrade check",
			};
	for (const [key, value] of Object.entries(expected)) {
		if (
			typeof pkgJson.scripts?.[key] === "string" &&
			pkgJson.scripts[key].includes("bun") &&
			(pkgJson.scripts[key].includes("--filter") ||
				pkgJson.scripts[key].includes("--cwd"))
		) {
			continue;
		}
		if (pkgJson.scripts?.[key] === value) continue;
		pkgJson.scripts ??= {};
		pkgJson.scripts[key] = value;
	}
	pkgJson.prettier = undefined;
	await writeManagedJson(file, pkgJson, dryRun);
	return true;
};
