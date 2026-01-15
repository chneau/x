import { $ } from "bun";

export const commandNew = async () => {
	await $`bun init -y .`;
	await $`x`;
	const {
		module,
		type,
		private: _,
		peerDependencies,
		devDependencies,
		scripts,
		...pkgJson
	} = await Bun.file("package.json").json();

	const newPkg = {
		...pkgJson,
		scripts: {
			start: "bun index.ts",
			dev: "bun --watch index.ts",
			...scripts,
		},
		dependencies: {},
		devDependencies: {
			...devDependencies,
			...peerDependencies,
		},
	};

	await Bun.write("package.json", JSON.stringify(newPkg, null, 2));
	await Bun.write("README.md", `# ${newPkg.name}`);
	await $`echo node_modules > .gitignore`;
	await $`bun run all`;
};
