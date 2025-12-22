import { $ } from "bun";

export const commandNew = async () => {
	await $`bun init -y .`;
	await $`x`;
	const pkgJson = await Bun.file("package.json").json();
	delete pkgJson.module;
	delete pkgJson.type;
	delete pkgJson.private;
	pkgJson.devDependencies = {
		...pkgJson.devDependencies,
		...pkgJson.peerDependencies,
	};
	delete pkgJson.peerDependencies;
	const devDependencies = pkgJson.devDependencies;
	delete pkgJson.devDependencies;
	pkgJson.scripts = {
		start: "bun index.ts",
		dev: "bun --watch index.ts",
		...pkgJson.scripts,
	};
	pkgJson.dependencies = {};
	pkgJson.devDependencies = devDependencies;
	await Bun.write("package.json", JSON.stringify(pkgJson, null, 2));
	await $`bun run all`;
	await $`echo node_modules > .gitignore`;
};
