import { readdir } from "node:fs/promises";
import { program } from "commander";
import { parse } from "jsonc-parser";

const getDirectories = async (path = ".") =>
	(await readdir(path, { withFileTypes: true }))
		.filter((x) => x.isDirectory())
		.filter((x) => !x.name.startsWith("."))
		.filter((x) => !x.name.includes("node_modules"))
		.map((x) => `${path}/${x.name}`);

const getDirectoriesDeep = async (path = ".", level = 0) => {
	if (level === 0) return [path];
	const directories = await getDirectories(path);
	let _level = level - 1;
	while (_level > 0) {
		for (const directory of directories) {
			const p = await getDirectories(directory);
			directories.push(...p);
		}
		_level--;
	}
	directories.push(path);
	return directories;
};

export const command = async () => {
	let cwd: string = program.processedArgs[0];
	if (typeof cwd !== "string") cwd = ".";
	console.log(cwd);
	let recursive: number = program.opts().recursive;
	if (typeof recursive !== "number") recursive = 0;
	if (recursive > 4) {
		console.error("👁️ Recursion level is too high");
		process.exit(1);
	}
	const directories = await getDirectoriesDeep(cwd, recursive);
	await Promise.all(directories.map((x) => purify(x)));
};

const purify = async (dir: string) => {
	console.log("🚀 Managing files in", dir);
	await managePackagelockjson(dir);
	const packageJsonExists = await managePackagejson(dir);
	const tsconfigExists = await manageTsconfig(dir);
	const isBunProject = packageJsonExists && tsconfigExists;
	await manageGitignore(dir, isBunProject);
	if (isBunProject) {
		console.log("🚀 Updating and checking everything!");
		await Promise.all([
			Bun.$`timeout 10s bun run upgrade`.quiet().nothrow(),
			Bun.$`timeout 10s bun run check`.nothrow(),
			Bun.$`timeout 10s bun run lint`.nothrow(),
		]);
	}
	console.log("🎉 Done with all files");
};

const managePackagelockjson = async (dir: string): Promise<boolean> => {
	const filename = `${dir}/package-lock.json`;
	const file = Bun.file(filename);
	if (!(await file.exists())) return false;
	await Bun.$`rm ${filename}`.quiet().nothrow();
	console.log(`✅ Done with ${filename}`);
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
	const lines = gitignore.split("\n");
	const isTooLong = lines.length > 10;
	if (isTooLong) console.error(`👁️ ${filename} is too long`);
	if (isBunProject) {
		const hasNodeModules = lines.includes("node_modules");
		if (!hasNodeModules) {
			lines.push("node_modules");
		}
	}
	await Bun.write(file, lines.join("\n"));
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
	};
	for (const [key, value] of Object.entries(expected)) {
		if (tsconfig.compilerOptions[key] === value) continue;
		tsconfig.compilerOptions[key] = value;
	}
	await Bun.write(file, JSON.stringify(tsconfig));
	await Bun.$`timeout 3s bun run check`.quiet().nothrow();
	console.log(`✅ Done with ${filename}`);
	return true;
};

const managePackagejson = async (dir: string): Promise<boolean> => {
	const filename = `${dir}/package.json`;
	const file = Bun.file(filename);
	if (!(await file.exists())) return false;
	const pkgJson = await file.json();
	if (!pkgJson.scripts) return false;
	const hasDependencies = pkgJson.dependencies || pkgJson.devDependencies;
	if (!hasDependencies) return false;
	const expected = {
		upgrade: "bun update --latest",
		check: "biome check --write --unsafe .",
		lint: "tsc",
		all: "bun run upgrade; bun run check; bun run lint",
	};
	for (const [key, value] of Object.entries(expected)) {
		if (pkgJson.scripts[key] === value) continue;
		pkgJson.scripts[key] = value;
	}
	await Bun.write(file, JSON.stringify(pkgJson));
	await Bun.$`timeout 3s bun run check`.quiet().nothrow();
	console.log(`✅ Done with ${filename}`);
	return true;
};
