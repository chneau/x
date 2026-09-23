import { existsSync, mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
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
	options: { template?: string; listTemplates?: boolean; force?: boolean } = {},
) => {
	if (options.listTemplates) {
		listTemplates();
		return;
	}

	const targetDir = resolve(dir);
	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
	} else if (!options.force) {
		const existingFiles = (
			await readdir(targetDir, { withFileTypes: true }).catch(() => [])
		).filter((e) => e.name !== ".git");
		if (existingFiles.length > 0) {
			console.error(
				`${c.red}❌ Target directory '${targetDir}' is not empty (${existingFiles.length} item(s) found).${c.reset}`,
			);
			console.error(
				`${c.dim}Pass ${c.cyan}-f, --force${c.reset}${c.dim} to scaffold anyway.${c.reset}`,
			);
			process.exit(1);
		}
	}

	const { template } = options;
	if (template && !(template in config.templates)) {
		const isGitSpecifier =
			template.includes("/") ||
			template.includes(":") ||
			template.startsWith("git@") ||
			template.startsWith("http");
		if (!isGitSpecifier) {
			console.error(`${c.red}❌ Unknown template: '${template}'${c.reset}\n`);
			listTemplates();
			process.exit(1);
		}
	}

	const originalCwd = process.cwd();
	process.chdir(targetDir);

	try {
		if (template) {
			const repoUrl =
				config.templates[template as keyof typeof config.templates] ?? template;
			console.log(`📦 Scaffolding from template '${template}'...`);
			const degitRes = await $`bunx degit --force ${repoUrl} .`
				.quiet()
				.nothrow();
			if (degitRes.exitCode !== 0) {
				const errText =
					degitRes.stderr.toString().trim() ||
					degitRes.stdout.toString().trim();
				console.error(
					`${c.red}❌ Failed to fetch template from '${repoUrl}'${c.reset}`,
				);
				if (errText) console.error(`   ${errText}`);
				process.exit(1);
			}
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
			await Bun.write(".gitignore", "node_modules\n");
		}

		await Bun.$`rm -f CLAUDE.md`.nothrow();
		await $`bun run all`;
	} finally {
		process.chdir(originalCwd);
	}
};
