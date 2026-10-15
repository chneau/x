import { readdir } from "node:fs/promises";
import { cpus } from "node:os";
import { join, relative, resolve } from "node:path";
import { mapConcurrent } from "../utils/helpers";

type CommandPyupOptions = {
	dryRun?: boolean;
	check?: boolean;
};

const UV_SHEBANG = "#!/usr/bin/env -S uv run --script\n";
const REQUIRES_PYTHON = ">=3.14";

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

const canonical = (name: string) => name.replace(/[-_.]+/g, "-").toLowerCase();

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

const parseDepsFromBlock = (block: string): string[] => {
	const match = block.match(DEPS_ARRAY_RE);
	if (!match?.[1]) return [];
	return [...match[1].matchAll(/"([^"]+)"/g)]
		.map((m) => m[1])
		.filter((dep): dep is string => Boolean(dep));
};

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
	} catch {}
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
	const isCheck = Boolean(options.check);
	const isPreview = isDryRun || isCheck;
	if (isPreview) {
		console.log(
			`🔍 Running in ${
				isDryRun ? "dry-run" : "check"
			} mode (no files will be modified)`,
		);
	}

	const files = await findPythonFiles(root);
	if (files.length === 0) {
		console.log(`No Python files found in '${cwd}'.`);
		return;
	}

	const local = localModuleNames(files);
	const concurrency = Math.max(cpus().length * 2, 2);

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

	const cache = new Map<string, string | null>();
	const unique = new Map<string, string>();
	for (const { names } of scanned) {
		for (const [key, value] of names) unique.set(key, value);
	}
	await mapConcurrent(
		[...unique.entries()].sort(([a], [b]) => a.localeCompare(b)),
		8,
		async ([, name]) => {
			await latestVersion(name, cache);
		},
	);

	const changed: string[] = [];
	for (const { file, text, names } of scanned) {
		const deps = [...names.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, name]) => {
				const version = cache.get(key);
				return version ? `${name}>=${version}` : name;
			});
		const updated = render(text, deps);
		if (updated === text) continue;

		changed.push(file);
		const label = relative(root, file) || file;
		if (isPreview) {
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

	const verb = isPreview ? "would be updated" : "updated";
	console.log(`\n${changed.length} of ${files.length} Python file(s) ${verb}.`);
	if (isCheck) process.exitCode = 1;
};
