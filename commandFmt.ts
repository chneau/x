import { $ } from "bun";

/**
 * Formatters per language/stack. Each is only run when the corresponding
 * files exist somewhere in the repo (checked with `git ls-files`, so
 * gitignored files are skipped).
 */
const formatters: { files: string[]; cmd: string }[] = [
	// TypeScript / JavaScript / JSON / CSS / Markdown
	{
		files: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.json", "*.css", "*.md"],
		cmd: "deno fmt --use-tabs --quiet; oxlint --fix-dangerously --quiet; biome check --write --unsafe .",
	},
	// Go
	{
		files: ["*.go"],
		cmd: "go fmt ./...",
	},
	// C# (dotnet tool `csharpier`)
	{
		files: ["*.cs", "*.csx"],
		cmd: "dotnet csharpier .",
	},
	// Python
	{
		files: ["*.py"],
		cmd: "ruff format .; ruff check --fix --quiet .",
	},
	// Rust
	{
		files: ["*.rs"],
		cmd: "cargo fmt",
	},
	// Java
	{
		files: ["*.java"],
		cmd: "google-java-format --replace $(git ls-files '*.java')",
	},
	// C / C++
	{
		files: ["*.c", "*.h", "*.cpp", "*.hpp", "*.cc"],
		cmd: "clang-format -i $(git ls-files '*.c' '*.h' '*.cpp' '*.hpp' '*.cc')",
	},
	// Ruby
	{
		files: ["*.rb", "Gemfile"],
		cmd: "rubocop --auto-correct --quiet",
	},
	// Shell scripts
	{
		files: ["*.sh"],
		cmd: "shfmt -w -i=tab $(git ls-files '*.sh')",
	},
	// SQL
	{
		files: ["*.sql"],
		cmd: "sqlfluff fix --dialect ansi",
	},
	// YAML (yamlfmt from gopkg)
	{
		files: ["*.yaml", "*.yml"],
		cmd: "yamlfmt .",
	},
	// Terraform
	{
		files: ["*.tf", "*.tfvars"],
		cmd: "terraform fmt -recursive",
	},
];

const shellEscape = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Run only if any of `files` are tracked by git. */
const fmtIfFiles = async ({ files, cmd }: { files: string[]; cmd: string }) => {
	const patterns = files.map(shellEscape).join(" ");
	const found = await $`git ls-files -- ${patterns}`.nothrow().text();
	if (!found.trim()) return;
	console.log(`→ fmt: ${cmd.split(" ")[0]} (${files[0]} files found)`);
	await $`${{ raw: cmd }}`.nothrow().quiet();
};

export const commandFmt = async () => void (await Promise.all(formatters.map(fmtIfFiles)));
