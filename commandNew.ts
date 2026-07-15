import { $ } from "bun";
import config from "./config.json";

export const commandNew = async (options: { template?: string }) => {
	const { template } = options;
	if (template) {
		const repoUrl =
			config.templates[template as keyof typeof config.templates] ?? template;
		await $`bunx degit --force ${repoUrl} .`;
	} else {
		await $`bun init -y .`;
	}

	await $`x`;

	const pkgFile = Bun.file("package.json");
	if (await pkgFile.exists()) {
		const {
			module,
			type,
			private: _,
			peerDependencies,
			devDependencies,
			scripts,
			dependencies,
			...pkgJson
		} = await pkgFile.json();

		const newPkg = {
			...pkgJson,
			version: undefined,
			name: process.cwd().split("/").pop(),
			scripts: {
				start: "bun index.ts",
				dev: "bun --watch index.ts",
				...scripts,
			},
			dependencies: dependencies ?? {},
			devDependencies: {
				...devDependencies,
				...peerDependencies,
			},
		};

		await Bun.write("package.json", JSON.stringify(newPkg, null, 2));
		const readmeFile = Bun.file("README.md");
		if (!(await readmeFile.exists())) {
			await Bun.write("README.md", `# ${newPkg.name ?? "New Project"}`);
		}
	}

	const gitignoreFile = Bun.file(".gitignore");
	if (!(await gitignoreFile.exists())) {
		await $`echo node_modules > .gitignore`;
	}

	await $`rm -rf CLAUDE.md`;

	await $`bun run all`;
};
