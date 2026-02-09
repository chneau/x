import { $ } from "bun";

export const commandNew = async (options: { template?: string }) => {
	const { template } = options;
	if (template) {
		let repoUrl = template;
		if (template === "bun-hono-react-template" || template === "web") {
			repoUrl = "https://github.com/chneau/bun-hono-react-template";
		}
		await $`bunx degit ${repoUrl} .`;
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

	await $`bun run all`;
};
