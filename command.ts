import { readdir } from "node:fs/promises";
import { cpus } from "node:os";
import { program } from "commander";
import { parse } from "jsonc-parser";
import PQueue from "p-queue";

const getDirectories = async (path = ".") =>
	(await readdir(path, { withFileTypes: true }))
		.filter((x) => x.isDirectory())
		.filter((x) => !x.name.startsWith("."))
		.filter((x) => !x.name.includes("node_modules"))
		.filter((x) => !x.name.includes(".git"))
		.map((x) => `${path}/${x.name}`);

const getDirectoriesDeep = async (path = ".", level = 0) => {
	const result = [path];
	if (level <= 0) return result;

	let currentLevel = [path];
	for (let i = 0; i < level; i++) {
		const dirsPerParent = await Promise.all(
			currentLevel.map((dir) => getDirectories(dir).catch(() => [])),
		);
		const nextLevel = dirsPerParent.flat();
		if (nextLevel.length === 0) break;
		result.push(...nextLevel);
		currentLevel = nextLevel;
	}
	return result;
};

export const command = async () => {
	let cwd: string = program.processedArgs[0];
	if (typeof cwd !== "string") cwd = ".";
	let recursive: number = program.opts().recursive;
	if (typeof recursive !== "number") recursive = 0;
	if (recursive > 4) {
		console.error("👁️ Recursion level is too high");
		process.exit(1);
	}
	const directories = await getDirectoriesDeep(cwd, recursive);
	const queue = new PQueue({ concurrency: cpus().length * 2 });
	await Promise.all(
		directories.map((dir) => queue.add(() => purify(dir).catch(console.error))),
	).catch(console.error);
};

const purify = async (dir: string) => {
	console.log(`🚀 Managing files in ${dir}`);
	await removeFileIfExists(dir, "package-lock.json").catch(console.error);
	await removeFileIfExists(dir, "yarn.lock").catch(console.error);
	const packageJsonExists = await managePackagejson(dir).catch(console.error);
	const tsconfigExists = await manageTsconfig(dir).catch(console.error);
	await manageGitignore(dir, packageJsonExists ?? false).catch(console.error);
	if (packageJsonExists) {
		console.log("🚀 Updating everything!");
		await Bun.$`timeout 20s bun run --cwd=${dir} upgrade`
			.nothrow()
			.catch(console.error);
	}
	if (tsconfigExists) {
		console.log("🚀 Checking and linting!");
		await Promise.all([
			Bun.$`timeout 6s bun run --cwd=${dir} check`.nothrow(),
			Bun.$`timeout 3s bun run --cwd=${dir} lint`.nothrow(),
		]).catch(console.error);
	}
	console.log("🎉 Done with all files");
};

const removeFileIfExists = async (
	dir: string,
	filename: string,
): Promise<boolean> => {
	const path = `${dir}/${filename}`;
	const file = Bun.file(path);
	if (!(await file.exists())) return false;
	await Bun.$`rm -f ${path}`.nothrow();
	console.log(`✅ Done with ${path}`);
	return true;
};

const manageGitignore = async (
	dir: string,
	isBunProject: boolean,
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
	await Bun.write(file, [...lines].join("\n"));
	console.log(`✅ Done with ${filename}`);
	return true;
};

const manageTsconfig = async (dir: string): Promise<boolean> => {
	const filename = `${dir}/tsconfig.json`;
	const file = Bun.file(filename);
	if (!(await file.exists())) return false;
	const tsconfig = parse(await file.text());
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
	await Bun.write(file, JSON.stringify(tsconfig, null, 2));
	await Bun.$`biome check --write --unsafe ${filename}`.nothrow();
	console.log(`✅ Done with ${filename}`);
	return true;
};

const managePackagejson = async (dir: string): Promise<boolean> => {
	const filename = `${dir}/package.json`;
	const file = Bun.file(filename);
	if (!(await file.exists())) return false;
	const pkgJson = await file.json();
	pkgJson.scripts ??= {};
	const hasDependencies = pkgJson.dependencies || pkgJson.devDependencies;
	if (!hasDependencies) return false;
	const expected = {
		upgrade: "bun update --latest",
		check:
			"deno fmt --use-tabs --quiet; oxlint --fix-dangerously --quiet; timeout 3s biome check --write --unsafe .",
		lint: "tsc --noEmit",
		all: "bun run upgrade; bun run check; bun run lint",
	};
	for (const [key, value] of Object.entries(expected)) {
		if (
			typeof pkgJson.scripts[key] === "string" &&
			pkgJson.scripts[key].includes("bun") &&
			(pkgJson.scripts[key].includes("--filter") ||
				pkgJson.scripts[key].includes("--cwd"))
		) {
			continue;
		}
		if (pkgJson.scripts[key] === value) continue;
		pkgJson.scripts[key] = value;
	}
	pkgJson.prettier = undefined;
	await Bun.write(file, JSON.stringify(pkgJson, null, 2));
	await Bun.$`biome check --write --unsafe ${filename}`.nothrow();
	console.log(`✅ Done with ${filename}`);
	return true;
};
