import { readdir } from "node:fs/promises";
import { program } from "commander";
import { parse } from "jsonc-parser";

const getDirectories = async () =>
	(await readdir(".", { withFileTypes: true }))
		.filter((x) => x.isDirectory())
		.filter((x) => !x.name.startsWith("."))
		.filter((x) => !x.name.includes("node_modules"))
		.map((x) => x.name);

export const command = async () => {
	let recursive: number = program.opts().recursive;
	if (typeof recursive !== "number") recursive = 0;
	if (recursive > 4) {
		console.error("👁️ Recursion level is too high");
		process.exit(1);
	}
	if (recursive > 0) {
		const directories = await getDirectories();
		const promises: Promise<unknown>[] = [];
		for (const directory of directories) {
			const p = Bun.$`x -r ${recursive - 1}`.cwd(directory).nothrow();
			promises.push(p);
		}
		await Promise.all(promises);
		return;
	}
	console.log("🚀 Managing files in", Bun.env.PWD);
	await managePackagelockjson();
	const packageJsonExists = await managePackagejson();
	const tsconfigExists = await manageTsconfig();
	const isBunProject = packageJsonExists && tsconfigExists;
	await manageGitignore(isBunProject);
	if (isBunProject) {
		console.log("🚀 Updating and checking everything!");
		await Promise.all([
			Bun.$`timeout 10s bun run upgrade`.quiet().nothrow(),
			Bun.$`timeout 10s bun run check`.quiet().nothrow(),
			Bun.$`timeout 10s bun run lint`.quiet().nothrow(),
		]);
	}
	console.log("🎉 Done with all files");
};

const managePackagelockjson = async () => {
	console.log("🚀 Managing package-lock.json");
	const file = Bun.file("package-lock.json");
	const exists = await file.exists();
	if (!exists) {
		console.error("✅ package-lock.json not found");
		return exists;
	}
	await Bun.$`rm package-lock.json`.quiet().nothrow();
	console.log("✅ Done with package-lock.json");
	return false;
};

const manageGitignore = async (isBunProject: boolean) => {
	console.log("🚀 Managing .gitignore");
	const file = Bun.file(".gitignore");
	const exists = await file.exists();
	if (!exists) return console.error("❌ .gitignore not found");
	const gitignore = await file.text();
	const lines = gitignore.split("\n");
	const isTooLong = lines.length > 10;
	if (isTooLong) {
		console.error("👁️ .gitignore is too long");
	}
	if (isBunProject) {
		const hasNodeModules = lines.includes("node_modules");
		if (!hasNodeModules) {
			console.log("⚡ Adding node_modules to .gitignore");
			lines.push("node_modules");
		}
	}
	console.log("⚡ Writing .gitignore");
	await Bun.write(file, lines.join("\n"));
	console.log("✅ Done with .gitignore");
};

const manageTsconfig = async () => {
	console.log("🚀 Managing tsconfig.json");
	const file = Bun.file("tsconfig.json");
	const exists = await file.exists();
	if (!exists) {
		console.error("❌ tsconfig.json not found");
		return exists;
	}
	const tsconfig = parse(await file.text());
	if (!tsconfig.compilerOptions) {
		console.error("❌ No compilerOptions found in tsconfig.json");
		return exists;
	}
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
		console.log(`⚡ Adding ${key} to tsconfig.json`);
		tsconfig.compilerOptions[key] = value;
	}
	console.log("⚡ Writing tsconfig.json");
	await Bun.write(file, JSON.stringify(tsconfig));
	await Bun.$`timeout 3s bun run check`.quiet().nothrow();
	console.log("✅ Done with tsconfig.json");
	return exists;
};

const managePackagejson = async () => {
	console.log("🚀 Managing package.json");
	const file = Bun.file("package.json");
	const exists = await file.exists();
	if (!exists) {
		console.error("❌ package.json not found");
		return exists;
	}
	const pkgJson = await file.json();
	if (!pkgJson.scripts) {
		console.error("❌ No scripts found in package.json");
		return exists;
	}
	const hasDependencies = pkgJson.dependencies || pkgJson.devDependencies;
	if (!hasDependencies) {
		console.error("❌ No dependencies found in package.json");
		return exists;
	}
	const expected = {
		upgrade: "bun update --latest",
		check: "biome check --write --unsafe .",
		lint: "tsc",
		all: "bun run upgrade; bun run check; bun run lint",
	};
	for (const [key, value] of Object.entries(expected)) {
		if (pkgJson.scripts[key] === value) continue;
		console.log(`⚡ Adding ${key} to package.json`);
		pkgJson.scripts[key] = value;
	}
	console.log("⚡ Writing package.json");
	await Bun.write(file, JSON.stringify(pkgJson));
	await Bun.$`timeout 3s bun run check`.quiet().nothrow();
	console.log("✅ Done with package.json");
	return exists;
};
