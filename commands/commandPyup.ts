import { readdir } from "node:fs/promises";
import { cpus } from "node:os";
import { join, relative, resolve } from "node:path";
import { mapConcurrent } from "../utils/helpers";

/**
 * Keep every Python file in a repo a modern, up-to-date uv script.
 *
 * For every `*.py` file (excluding virtualenvs, caches and generated dirs):
 *  1. makes it a uv script  — a `python`/`python3` shebang is replaced with
 *     `#!/usr/bin/env -S uv run --script` and an inline PEP 723 metadata block
 *     is inserted when missing;
 *  2. pins Python 3.14      — `requires-python = ">=3.14"`;
 *  3. uses the latest deps  — declared dependencies plus third-party imports are
 *     resolved to their latest PyPI release and rewritten as `>=<latest>`.
 *
 * Usage:
 *   x pyup                 # rewrite files in place
 *   x pyup --dry-run       # preview only
 *   x pyup --check         # exit 1 if anything is out of date
 */

type CommandPyupOptions = {
	dryRun?: boolean;
	check?: boolean;
};

const UV_SHEBANG = "#!/usr/bin/env -S uv run --script\n";
const REQUIRES_PYTHON = ">=3.14";

/** Directories that never contain hand-written scripts we want to touch. */
const EXCLUDED_DIRS = new Set([
	".git",
	".hg",
	".svn",
	".venv",
	"venv",
	"env",
	"__pycache__",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".tox",
	".nox",
	"node_modules",
	"build",
	"dist",
]);

/** Python standard-library top-level modules (from `sys.stdlib_module_names`). */
const STDLIB = new Set([
	"abc",
	"annotationlib",
	"antigravity",
	"argparse",
	"array",
	"ast",
	"asyncio",
	"atexit",
	"base64",
	"bdb",
	"binascii",
	"bisect",
	"builtins",
	"bz2",
	"cProfile",
	"calendar",
	"cmath",
	"cmd",
	"code",
	"codecs",
	"codeop",
	"collections",
	"colorsys",
	"compileall",
	"compression",
	"concurrent",
	"configparser",
	"contextlib",
	"contextvars",
	"copy",
	"copyreg",
	"csv",
	"ctypes",
	"curses",
	"dataclasses",
	"datetime",
	"dbm",
	"decimal",
	"difflib",
	"dis",
	"doctest",
	"email",
	"encodings",
	"ensurepip",
	"enum",
	"errno",
	"faulthandler",
	"fcntl",
	"filecmp",
	"fileinput",
	"fnmatch",
	"fractions",
	"ftplib",
	"functools",
	"gc",
	"genericpath",
	"getopt",
	"getpass",
	"gettext",
	"glob",
	"graphlib",
	"grp",
	"gzip",
	"hashlib",
	"heapq",
	"hmac",
	"html",
	"http",
	"idlelib",
	"imaplib",
	"importlib",
	"inspect",
	"io",
	"ipaddress",
	"itertools",
	"json",
	"keyword",
	"linecache",
	"locale",
	"logging",
	"lzma",
	"mailbox",
	"marshal",
	"math",
	"mimetypes",
	"mmap",
	"modulefinder",
	"msvcrt",
	"multiprocessing",
	"netrc",
	"nt",
	"ntpath",
	"nturl2path",
	"numbers",
	"opcode",
	"operator",
	"optparse",
	"os",
	"pathlib",
	"pdb",
	"pickle",
	"pickletools",
	"pkgutil",
	"platform",
	"plistlib",
	"poplib",
	"posix",
	"posixpath",
	"pprint",
	"profile",
	"pstats",
	"pty",
	"pwd",
	"py_compile",
	"pyclbr",
	"pydoc",
	"pydoc_data",
	"pyexpat",
	"queue",
	"quopri",
	"random",
	"re",
	"readline",
	"reprlib",
	"resource",
	"rlcompleter",
	"runpy",
	"sched",
	"secrets",
	"select",
	"selectors",
	"shelve",
	"shlex",
	"shutil",
	"signal",
	"site",
	"smtplib",
	"socket",
	"socketserver",
	"sqlite3",
	"sre_compile",
	"sre_constants",
	"sre_parse",
	"ssl",
	"stat",
	"statistics",
	"string",
	"stringprep",
	"struct",
	"subprocess",
	"symtable",
	"sys",
	"sysconfig",
	"syslog",
	"tabnanny",
	"tarfile",
	"tempfile",
	"termios",
	"textwrap",
	"this",
	"threading",
	"time",
	"timeit",
	"tkinter",
	"token",
	"tokenize",
	"tomllib",
	"trace",
	"traceback",
	"tracemalloc",
	"tty",
	"turtle",
	"turtledemo",
	"types",
	"typing",
	"unicodedata",
	"unittest",
	"urllib",
	"uuid",
	"venv",
	"warnings",
	"wave",
	"weakref",
	"webbrowser",
	"winreg",
	"winsound",
	"wsgiref",
	"xml",
	"xmlrpc",
	"zipapp",
	"zipfile",
	"zipimport",
	"zlib",
	"zoneinfo",
]);

/** Import name -> PyPI distribution name, for the cases where they differ. */
const IMPORT_TO_PYPI: Record<string, string> = {
	attr: "attrs",
	bs4: "beautifulsoup4",
	cv2: "opencv-python",
	dateutil: "python-dateutil",
	dotenv: "python-dotenv",
	git: "GitPython",
	jwt: "PyJWT",
	PIL: "pillow",
	pkg_resources: "setuptools",
	serial: "pyserial",
	skimage: "scikit-image",
	sklearn: "scikit-learn",
	yaml: "PyYAML",
	OpenSSL: "pyOpenSSL",
};

const SHEBANG_RE = /^#!.*\r?\n/;
const SCRIPT_BLOCK_RE = /^# \/\/\/ script\r?\n(?:#.*\r?\n)*?# \/\/\/\r?\n/m;
const IMPORT_RE = /^\s*(?:from|import)\s+([A-Za-z_]\w*)/gm;
const DEP_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(.*)$/;
const DEPS_ARRAY_RE = /# dependencies = \[([\s\S]*?)\]/;

/** PEP 503 normalisation, used to de-duplicate distributions. */
const canonical = (name: string) => name.replace(/[-_.]+/g, "-").toLowerCase();

/** Depth-first list of `*.py` files, skipping generated/excluded directories. */
const findPythonFiles = async (root: string): Promise<string[]> => {
	const results: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!EXCLUDED_DIRS.has(entry.name)) await walk(full);
			} else if (entry.isFile() && entry.name.endsWith(".py")) {
				results.push(full);
			}
		}
	};
	await walk(root);
	return results.sort();
};

/** Stems of every discovered file, so sibling imports are not treated as deps. */
const localModuleNames = (files: string[]): Set<string> => {
	const names = new Set<string>();
	for (const file of files) {
		const parts = file.split(/[\\/]/);
		const stem = (parts.at(-1) ?? "").replace(/\.py$/, "");
		if (stem) names.add(stem);
		const parent = parts.at(-2);
		if (stem === "__init__" && parent) names.add(parent);
	}
	return names;
};

/** Read `dependencies` out of a raw inline-metadata block. */
const parseDepsFromBlock = (block: string): string[] => {
	const match = block.match(DEPS_ARRAY_RE);
	if (!match?.[1]) return [];
	return [...match[1].matchAll(/"([^"]+)"/g)]
		.map((m) => m[1])
		.filter((dep): dep is string => Boolean(dep));
};

/** Map top-level third-party imports to PyPI distribution names. */
const importedDistributions = (
	text: string,
	local: Set<string>,
): Map<string, string> => {
	const found = new Map<string, string>();
	for (const match of text.matchAll(IMPORT_RE)) {
		const module = match[1];
		if (
			!module ||
			module.startsWith("_") ||
			STDLIB.has(module) ||
			local.has(module)
		) {
			continue;
		}
		const dist = IMPORT_TO_PYPI[module] ?? module;
		if (!found.has(canonical(dist))) found.set(canonical(dist), dist);
	}
	return found;
};

const depName = (spec: string): string =>
	spec.trim().match(DEP_RE)?.[1] ?? spec.trim();

/** Resolve a distribution's latest release from PyPI, caching (incl. failures). */
const latestVersion = async (
	name: string,
	cache: Map<string, string | null>,
): Promise<string | null> => {
	const key = canonical(name);
	const cached = cache.get(key);
	if (cached !== undefined) return cached;
	let version: string | null = null;
	try {
		const response = await fetch(
			`https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
			{ headers: { "user-agent": "chneau-x-pyup/1.0" } },
		);
		if (response.ok) {
			const data = (await response.json()) as {
				info?: { version?: string };
			};
			version = data.info?.version ?? null;
		}
	} catch {
		// handled below
	}
	if (!version) console.error(`   ! could not resolve latest '${name}'`);
	cache.set(key, version);
	return version;
};

const buildBlock = (deps: string[]): string => {
	const depsToml = deps.length
		? `# dependencies = [\n${deps
				.map((dep) => `#   ${JSON.stringify(dep)},`)
				.join("\n")}\n# ]`
		: "# dependencies = []";
	return `# /// script\n# requires-python = "${REQUIRES_PYTHON}"\n${depsToml}\n# ///\n`;
};

const render = (text: string, deps: string[]): string => {
	const match = SHEBANG_RE.exec(text);
	const header = match?.[0] ?? "";
	let body = match ? text.slice(match[0].length) : text;
	body = body.replace(SCRIPT_BLOCK_RE, "").replace(/^\n+/, "");
	const newHeader = header.includes("uv run --script") ? header : UV_SHEBANG;
	return `${newHeader}${buildBlock(deps)}${body}`;
};

type Scanned = {
	file: string;
	text: string;
	names: Map<string, string>;
};

export const commandPyup = async (
	dir = ".",
	options: CommandPyupOptions = {},
) => {
	const cwd = typeof dir === "string" && dir.trim().length > 0 ? dir : ".";
	const root = resolve(cwd);
	const isDryRun = Boolean(options.dryRun);
	if (isDryRun) {
		console.log("🔍 Running in dry-run mode (no files will be modified)");
	}

	const files = await findPythonFiles(root);
	if (files.length === 0) {
		console.log(`No Python files found in '${cwd}'.`);
		return;
	}

	const local = localModuleNames(files);
	const concurrency = Math.max(cpus().length * 2, 2);

	// Pass 1: read every file and collect the distributions it needs.
	const scanned = await mapConcurrent(
		files,
		concurrency,
		async (file): Promise<Scanned> => {
			const text = await Bun.file(file).text();
			const names = new Map<string, string>();
			const block = text.match(SCRIPT_BLOCK_RE)?.[0];
			if (block) {
				for (const spec of parseDepsFromBlock(block)) {
					const name = depName(spec);
					if (name) names.set(canonical(name), name);
				}
			}
			for (const [key, value] of importedDistributions(text, local)) {
				if (!names.has(key)) names.set(key, value);
			}
			return { file, text, names };
		},
	);

	// Pass 2: resolve the latest version of every unique distribution once.
	const cache = new Map<string, string | null>();
	const unique = new Map<string, string>();
	for (const { names } of scanned) {
		for (const [key, value] of names) unique.set(key, value);
	}
	await mapConcurrent(
		[...unique.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
		8,
		async ([, name]) => {
			await latestVersion(name, cache);
		},
	);

	// Pass 3: rewrite and (unless dry-run) persist every changed file.
	const changed: string[] = [];
	for (const { file, text, names } of scanned) {
		const deps = [...names.entries()]
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, name]) => {
				const version = cache.get(key);
				return version ? `${name}>=${version}` : name;
			});
		const updated = render(text, deps);
		if (updated === text) continue;

		changed.push(file);
		const label = relative(root, file) || file;
		if (isDryRun) {
			console.log(`🔍 [would update] ${label}`);
		} else {
			await Bun.write(file, updated);
			console.log(`✅ [update] ${label}`);
		}
	}

	if (changed.length === 0) {
		console.log(`🎉 All ${files.length} Python file(s) already up to date.`);
		return;
	}

	const verb = isDryRun ? "would be updated" : "updated";
	console.log(`\n${changed.length} of ${files.length} Python file(s) ${verb}.`);
	if (options.check && !isDryRun) process.exitCode = 1;
};
