#!/usr/bin/env bun
import "./verboseShell";
import { Option, program } from "commander";
import {
	commandCleanShortcuts,
	commandDeck,
	commandDeckDisk,
} from "./commandDeck";
import { commandDeploy } from "./commandDeploy";
import { commandDisk } from "./commandDisk";
import { commandDoctor } from "./commandDoctor";
import { commandFmt } from "./commandFmt";
import { commandGitclean } from "./commandGitclean";
import { commandHelm } from "./commandHelm";
import { commandNew } from "./commandNew";
import { commandPrs } from "./commandPrs";
import { commandPurify } from "./commandPurify";
import { commandUpgrade } from "./commandUpgrade";
import { commandVtracer } from "./commandVtracer";
import config from "./config.json";
import { getCurrentVersion } from "./helpers";
import { commandDiskWindows } from "./windows/commandDiskWindows";

const version = await getCurrentVersion();

/** Parse a stringy CLI value into a finite number or throw. */
const parseNumber = (val: string) => {
	const parsed = Number(val);
	if (Number.isNaN(parsed)) {
		throw new Error(`Expected a number, got "${val}"`);
	}
	return parsed;
};

/** Split a CLI list like "#fff,#000" into strings, trimming whitespace. */
const parseList = (val: string) =>
	val
		.split(",")
		.map((x) => x.trim())
		.filter((x) => x.length > 0);

program.name("x").description("chneau's utility CLI").version(version);

program
	.command("gitclean")
	.description(
		"Prune, repack, fetch prune, and clean git repositories in parallel",
	)
	.argument("[dir]", "Directory to search for git repositories", ".")
	.option(
		"-r, --recursive <number>",
		"Recursion depth limit",
		(val) => {
			const parsed = Number.parseInt(val, 10);
			if (Number.isNaN(parsed) || parsed < 0) {
				throw new Error("Recursion depth must be a non-negative integer");
			}
			return parsed;
		},
		1,
	)
	.option(
		"-c, --concurrency <number>",
		"Number of concurrent workers",
		(val) => {
			const parsed = Number.parseInt(val, 10);
			if (Number.isNaN(parsed) || parsed < 1) {
				throw new Error("Concurrency must be a positive integer");
			}
			return parsed;
		},
		10,
	)
	.action(commandGitclean);

program
	.command("purify")
	.description(
		"Sanitize & modernize project configuration (package.json, tsconfig, gitignore)",
	)
	.argument("[dir]", "Directory to manage", ".")
	.option(
		"-r, --recursive <number>",
		"Recursion level (0-4)",
		(val) => {
			const parsed = Number.parseInt(val, 10);
			if (Number.isNaN(parsed) || parsed < 0 || parsed > 4) {
				throw new Error("Recursion level must be an integer between 0 and 4");
			}
			return parsed;
		},
		0,
	)
	.option(
		"-d, --dry-run",
		"Preview changes without modifying files or running commands",
		false,
	)
	.action(commandPurify);

program
	.command("fmt")
	.description(
		"Format code across all supported languages (Deno, Biome, Go, C#)",
	)
	.action(commandFmt);

const prs = program
	.command("prs")
	.description("Manage GitHub pull requests (merge/close bot & dependency PRs)")
	.option(
		"-o, --owner <owner>",
		"GitHub owner / user (defaults to current gh user)",
	)
	.option(
		"-c, --concurrency <number>",
		"Number of concurrent workers",
		Number.parseInt,
	)
	.action(commandPrs);

prs
	.command("clean")
	.description("Clean and merge/close open Renovate and Dependabot PRs")
	.option(
		"-o, --owner <owner>",
		"GitHub owner / user (defaults to current gh user)",
	)
	.option(
		"-c, --concurrency <number>",
		"Number of concurrent workers",
		Number.parseInt,
	)
	.action(commandPrs);

const deck = program
	.command("deck")
	.description("Manage, clean, and update Steam Deck")
	.option("-h, --host <host>", "SSH host name", "steamdeck")
	.option("-s, --sudo-password <password>", "Sudo password for Steam Deck")
	.action(commandDeck);

deck
	.command("shortcuts")
	.description("Clean broken non-Steam shortcuts from shortcuts.vdf")
	.option("-h, --host <host>", "SSH host name", "steamdeck")
	.option("-p, --shortcuts-path <path>", "Custom shortcuts.vdf path")
	.option("-d, --dry-run", "Preview broken shortcuts without deleting")
	.action(commandCleanShortcuts);

deck
	.command("disk")
	.description("Inspect disk space usage and categories on Steam Deck")
	.option("-h, --host <host>", "SSH host name", "steamdeck")
	.action(commandDeckDisk);

deck
	.command("update")
	.description("Update Discover flatpaks, SteamOS, and Decky Loader")
	.option("-h, --host <host>", "SSH host name", "steamdeck")
	.option("-s, --sudo-password <password>", "Sudo password for Steam Deck")
	.option("--no-flatpaks", "Skip Flatpak/Discover updates")
	.option("--no-os", "Skip SteamOS update")
	.option("--no-games", "Skip Steam game/runtime updates check")
	.option("--no-decky", "Skip Decky Loader update")
	.action(commandDeck);

program
	.command("deploy")
	.description("Deploy CDK8s Kubernetes manifests to cluster")
	.allowExcessArguments()
	.action(commandDeploy);

program
	.command("helm")
	.description("Manage and upgrade Helm charts in current kubernetes context")
	.argument("[releases...]", "Specific release names to check or upgrade")
	.option("-u, --upgrade", "Upgrade the releases if dry runs pass")
	.option("-a, --all", "Check or upgrade all releases")
	.action(commandHelm);

program
	.command("upgrade")
	.description("Upgrade x CLI to the latest version")
	.action(commandUpgrade);

program
	.command("disk")
	.description("Analyze disk space usage and clean caches in home directory")
	.option(
		"-c, --clean",
		"Automatically clean reclaimable caches and temporary files",
		false,
	)
	.option(
		"-d, --dry-run",
		"Preview space that will be reclaimed without deleting",
		false,
	)
	.option(
		"-t, --top <number>",
		"Number of largest files to display in inspection mode",
		(val) => Number.parseInt(val, 10),
		15,
	)
	.action(commandDisk);

program
	.command("disk-windows")
	.description(
		"Analyze disk space usage and clean caches in Windows (native or via WSL)",
	)
	.option(
		"-c, --clean",
		"Automatically clean reclaimable caches and temporary files",
		false,
	)
	.option(
		"-d, --dry-run",
		"Preview space that will be reclaimed without deleting",
		false,
	)
	.option(
		"-t, --top <number>",
		"Number of largest files to display in inspection mode",
		(val) => Number.parseInt(val, 10),
		15,
	)
	.action(commandDiskWindows);

program
	.command("doctor")
	.description(
		"Diagnose and repair development environment tools & git configs",
	)
	.option("-e, --email <email>", "Git email", config.git.defaultEmail)
	.option("-n, --name <name>", "Git name", config.git.defaultName)
	.option("--no-updates", "Skip system updates")
	.action(commandDoctor);

program
	.command("new")
	.description("Scaffold and initialize a new project")
	.argument("[dir]", "Target directory for the new project", ".")
	.option("-t, --template <template-name>", "Template name or git repository")
	.action(commandNew);

program
	.command("vtracer")
	.description(
		"Raster to vector (SVG) converter powered by @visioncortex/vtracer",
	)
	.argument("<input>", "Input image path (.png/.jpg/.gif/.bmp)")
	.argument("[output]", "Output SVG path (defaults to <input>.svg)")
	.addOption(
		new Option(
			"-p, --preset <preset>",
			"Preset applied before other options",
		).choices(["bw", "poster", "photo"]),
	)
	.addOption(
		new Option(
			"-c, --clustering <clustering>",
			"Region forming algorithm",
		).choices(["color-cluster", "bw", "watershed"]),
	)
	.addOption(
		new Option(
			"-l, --hierarchical <hierarchical>",
			"Layer order for stacked regions",
		).choices(["stacked", "cutout"]),
	)
	.addOption(
		new Option("-m, --mode <mode>", "Output type").choices([
			"pixel",
			"polygon",
			"spline",
		]),
	)
	.option(
		"--filter-speckle <number>",
		"Filter out speckles smaller than this area (px²)",
		parseNumber,
	)
	.option(
		"--color-precision <number>",
		"Color precision of the hierarchical clustering",
		parseNumber,
	)
	.option(
		"--layer-difference <number>",
		"Layer difference of the hierarchical clustering",
		parseNumber,
	)
	.option(
		"--corner-threshold <number>",
		"Corner threshold for polygon/spline mode",
		parseNumber,
	)
	.option(
		"--length-threshold <number>",
		"Length threshold for polygon/spline mode",
		parseNumber,
	)
	.option(
		"--max-iterations <number>",
		"Max iterations for spline fitting",
		parseNumber,
	)
	.option(
		"--splice-threshold <number>",
		"Splice threshold for spline fitting",
		parseNumber,
	)
	.option(
		"--simplify <number>",
		"Curve simplification tolerance in px (omit to disable; try 1-2.5)",
		parseNumber,
	)
	.option(
		"--path-precision <number>",
		"Precision of path generation",
		parseNumber,
	)
	.option(
		"--palette <colors>",
		'Fixed palette as a comma-separated list of #rrggbb, e.g. "#000,#fff"',
		parseList,
	)
	.option(
		"--max-colors <number>",
		"Auto-quantize target color count",
		parseNumber,
	)
	.option(
		"--optimize <number>",
		"Optimization level: 0=off, 1=quantize+simplify, 2=+shorthands/grouping",
		parseNumber,
	)
	.option(
		"--binary-threshold <number>",
		"Binary mode fixed threshold (0-255); foreground is below it",
		parseNumber,
	)
	.option("--adaptive", "Binary mode: use Bradley-Roth adaptive thresholding")
	.option(
		"--adaptive-window <number>",
		"Adaptive threshold window side length in px (0 = auto)",
		parseNumber,
	)
	.option(
		"--adaptive-t <number>",
		"Adaptive sensitivity (percent below local mean, default 15)",
		parseNumber,
	)
	.option(
		"--watershed-detail <number>",
		"Watershed hierarchy cut level (default 128; higher = more regions)",
		parseNumber,
	)
	.option(
		"-v, --verbose",
		"Print the conversion parameters being applied",
		false,
	)
	.action(commandVtracer);

program.parse();
