import { $ } from "bun";
import { c } from "../utils/helpers";

/**
 * Formatters per language/stack. Each is only run when the corresponding
 * files exist somewhere in the repo (checked with `git ls-files`, so
 * gitignored files are skipped).
 */
const formatters: {
	name: string;
	files: string[];
	cmd: string;
	checkCmd?: string;
}[] = [
	// TypeScript / JavaScript / JSON / CSS / Markdown
	{
		name: "Deno/Oxlint/Biome (TS/JS/JSON/MD)",
		files: [
			"*.ts",
			"*.tsx",
			"*.js",
			"*.jsx",
			"*.mjs",
			"*.cjs",
			"*.json",
			"*.css",
			"*.md",
		],
		cmd: "deno fmt --use-tabs --quiet; oxlint --fix-dangerously --quiet; biome check --write --unsafe .",
		checkCmd:
			"deno fmt --check --use-tabs --quiet && oxlint --quiet && biome check .",
	},
	// Go
	{
		name: "Go (go fmt)",
		files: ["*.go"],
		cmd: "go fmt ./...",
		checkCmd: "test -z $(gofmt -l .)",
	},
	// C# (dotnet tool `csharpier`)
	{
		name: "C# (csharpier)",
		files: ["*.cs", "*.csx"],
		cmd: "dotnet csharpier .",
		checkCmd: "dotnet csharpier --check .",
	},
	// Python
	{
		name: "Python (ruff)",
		files: ["*.py"],
		cmd: "ruff format .; ruff check --fix --quiet .",
		checkCmd: "ruff format --check . && ruff check .",
	},
	// Rust
	{
		name: "Rust (cargo fmt)",
		files: ["*.rs"],
		cmd: "cargo fmt",
		checkCmd: "cargo fmt -- --check",
	},
	// Java
	{
		name: "Java (google-java-format)",
		files: ["*.java"],
		cmd: "google-java-format --replace $(git ls-files '*.java')",
		checkCmd:
			"google-java-format --dry-run --set-exit-if-changed $(git ls-files '*.java')",
	},
	// C / C++
	{
		name: "C/C++ (clang-format)",
		files: ["*.c", "*.h", "*.cpp", "*.hpp", "*.cc"],
		cmd: "clang-format -i $(git ls-files '*.c' '*.h' '*.cpp' '*.hpp' '*.cc')",
		checkCmd:
			"clang-format --dry-run --Werror $(git ls-files '*.c' '*.h' '*.cpp' '*.hpp' '*.cc')",
	},
	// Ruby
	{
		name: "Ruby (rubocop)",
		files: ["*.rb", "Gemfile"],
		cmd: "rubocop --autocorrect .",
		checkCmd: "rubocop .",
	},
	// Shell scripts (tabs are shfmt's default indent)
	{
		name: "Shell (shfmt)",
		files: ["*.sh"],
		cmd: "shfmt -w .",
		checkCmd: "shfmt -d .",
	},
	// SQL
	{
		name: "SQL (sqlfluff)",
		files: ["*.sql"],
		cmd: "sqlfluff fix --dialect ansi",
		checkCmd: "sqlfluff lint --dialect ansi",
	},
	// YAML (yamlfmt from gopkg)
	{
		name: "YAML (yamlfmt)",
		files: ["*.yaml", "*.yml"],
		cmd: "yamlfmt .",
		checkCmd: "yamlfmt -dry .",
	},
	// Terraform
	{
		name: "Terraform (terraform fmt)",
		files: ["*.tf", "*.tfvars"],
		cmd: "terraform fmt -recursive",
		checkCmd: "terraform fmt -check -recursive",
	},
];

const shellEscape = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

type FmtOptions = {
	check?: boolean;
};

export const commandFmt = async (options: FmtOptions = {}) => {
	const isCheck = Boolean(options.check);
	let executedCount = 0;
	let hasError = false;

	for (const formatter of formatters) {
		const patterns = formatter.files.map(shellEscape).join(" ");
		const found = await $`git ls-files -- ${patterns}`.nothrow().text();
		if (!found.trim()) continue;

		const fileCount = found.trim().split("\n").filter(Boolean).length;
		executedCount++;

		const cmdToRun =
			isCheck && formatter.checkCmd ? formatter.checkCmd : formatter.cmd;
		console.log(
			`→ fmt: ${formatter.name} (${c.cyan}${fileCount}${c.reset} file(s) matched)`,
		);
		const res = await $`${{ raw: cmdToRun }}`.nothrow();
		if (res.exitCode !== 0) {
			hasError = true;
			console.error(
				`  ${c.red}❌ Formatter '${formatter.name}' reported issues.${c.reset}`,
			);
		}
	}

	if (executedCount === 0) {
		console.log("ℹ️  No format-eligible files tracked in git.");
		return;
	}

	if (hasError) {
		if (isCheck) {
			console.error(`\n${c.red}❌ Formatting check failed.${c.reset}`);
			process.exitCode = 1;
		} else {
			console.error(
				`\n${c.yellow}⚠️ Some formatters encountered warnings or errors.${c.reset}`,
			);
		}
	} else {
		console.log(
			`\n${c.green}✅ All formatting checks passed (${executedCount} tools executed).${c.reset}`,
		);
	}
};
