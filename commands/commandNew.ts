import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { $ } from "bun";
import config from "../config.json";
import { c, pad } from "../utils/helpers";
import { commandPurify } from "./commandPurify";

/** Templates from config.json, grouped so aliases pointing at the same repo share a line. */
const templateGroups = () => {
	const byRepo = new Map<string, string[]>();
	for (const [name, repo] of Object.entries(config.templates)) {
		byRepo.set(repo, [...(byRepo.get(repo) ?? []), name].sort());
	}
	return [...byRepo.entries()]
		.map(([repo, names]) => ({ repo, names }))
		.sort((a, b) => (a.names[0] ?? "").localeCompare(b.names[0] ?? ""));
};

/** `x new --list-templates` — print the configured templates and their aliases. */
const listTemplates = () => {
	const groups = templateGroups();
	const width = Math.max(...groups.map((g) => g.names.join(", ").length), 0);
	console.log("Available templates (use -t/--template <name>):");
	for (const { repo, names } of groups) {
		const aliases = names
			.map((name) => `${c.cyan}${name}${c.reset}`)
			.join(", ");
		console.log(
			` ${c.green}•${c.reset} ${pad(
				aliases,
				width,
			)}  ${c.gray}${repo}${c.reset}`,
		);
	}
	console.log(
		`\nAny other value is passed to ${c.cyan}degit${c.reset} as a template shorthand or git repository URL.`,
	);
};

export const commandNew = async (
	dir = ".",
	options: { template?: string; listTemplates?: boolean } = {},
) => {
	if (options.listTemplates) {
		listTemplates();
		return;
	}

	const targetDir = resolve(dir);
	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
	}

	const originalCwd = process.cwd();
	process.chdir(targetDir);

	try {
		const { template } = options;
		if (template) {
			const repoUrl =
				config.templates[template as keyof typeof config.templates] ?? template;
			await $`bunx degit --force ${repoUrl} .`;
		} else {
			await $`bun init -y .`;
		}

		await commandPurify(".", { recursive: 0 });

		const pkgFile = Bun.file("package.json");
		if (await pkgFile.exists()) {
			const {
				module: _module,
				type: _type,
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
				name: basename(targetDir),
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
	} finally {
		process.chdir(originalCwd);
	}
};
