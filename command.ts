import { parse } from "jsonc-parser";

export const command = async () => {
	const packageJsonExists = await managePackagejson();
	const tsconfigExists = await manageTsconfig();
	const isBunProject = packageJsonExists && tsconfigExists;
	await manageGitignore(isBunProject);
	if (isBunProject) {
		console.log("🚀 Updating and checking everything!");
		await Bun.$`bun run all`;
	}
	console.log("🎉 Done with all files");
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
		console.warn("👁️ .gitignore is too long");
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
	const noUnusedLocals = true;
	const noUnusedParameters = true;
	const noUncheckedIndexedAccess = true;
	const noFallthroughCasesInSwitch = true;
	const noEmit = true;
	const strict = true;
	const skipLibCheck = true;
	if (tsconfig.compilerOptions.noUnusedLocals !== noUnusedLocals) {
		console.log("⚡ Adding noUnusedLocals to tsconfig.json");
		tsconfig.compilerOptions.noUnusedLocals = noUnusedLocals;
	}
	if (tsconfig.compilerOptions.noUnusedParameters !== noUnusedParameters) {
		console.log("⚡ Adding noUnusedParameters to tsconfig.json");
		tsconfig.compilerOptions.noUnusedParameters = noUnusedParameters;
	}
	if (
		tsconfig.compilerOptions.noUncheckedIndexedAccess !==
		noUncheckedIndexedAccess
	) {
		console.log("⚡ Adding noUncheckedIndexedAccess to tsconfig.json");
		tsconfig.compilerOptions.noUncheckedIndexedAccess =
			noUncheckedIndexedAccess;
	}
	if (
		tsconfig.compilerOptions.noFallthroughCasesInSwitch !==
		noFallthroughCasesInSwitch
	) {
		console.log("⚡ Adding noFallthroughCasesInSwitch to tsconfig.json");
		tsconfig.compilerOptions.noFallthroughCasesInSwitch =
			noFallthroughCasesInSwitch;
	}
	if (tsconfig.compilerOptions.noEmit !== noEmit) {
		console.log("⚡ Adding noEmit to tsconfig.json");
		tsconfig.compilerOptions.noEmit = noEmit;
	}
	if (tsconfig.compilerOptions.strict !== strict) {
		console.log("⚡ Adding strict to tsconfig.json");
		tsconfig.compilerOptions.strict = strict;
	}
	if (tsconfig.compilerOptions.skipLibCheck !== skipLibCheck) {
		console.log("⚡ Adding skipLibCheck to tsconfig.json");
		tsconfig.compilerOptions.skipLibCheck = skipLibCheck;
	}
	console.log("⚡ Writing tsconfig.json");
	await Bun.write(file, JSON.stringify(tsconfig));
	await Bun.$`bun run check`.quiet();
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
	const upgrade = "bun update --latest";
	const check = "biome check --write --unsafe .";
	const lint = "tsc";
	const all = "bun run upgrade; bun run check; bun run lint";
	if (pkgJson.scripts.upgrade !== upgrade) {
		console.log("⚡ Adding upgrade script to package.json");
		pkgJson.scripts.upgrade = upgrade;
	}
	if (pkgJson.scripts.check !== check) {
		console.log("⚡ Adding check script to package.json");
		pkgJson.scripts.check = check;
	}
	if (pkgJson.scripts.lint !== lint) {
		console.log("⚡ Adding lint script to package.json");
		pkgJson.scripts.lint = lint;
	}
	if (pkgJson.scripts.all !== all) {
		console.log("⚡ Adding all script to package.json");
		pkgJson.scripts.all = all;
	}
	console.log("⚡ Writing package.json");
	await Bun.write(file, JSON.stringify(pkgJson));
	await Bun.$`bun run check`.quiet();
	console.log("✅ Done with package.json");
	return exists;
};
