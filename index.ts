#!/usr/bin/env bun
import "./verboseShell";
import { program } from "commander";
import {
	commandCfDomainsList,
	commandCfLogin,
	commandCfLoginList,
	commandCfLoginRemove,
	commandCfLoginUse,
	commandCfLogout,
	commandCfMailforwardingList,
	commandCfMailforwardingSet,
} from "./commandCf";
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
import config from "./config.json";
import { getCurrentVersion } from "./helpers";
import { commandDiskWindows } from "./windows/commandDiskWindows";

const version = await getCurrentVersion();

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

const cf = program
	.command("cf")
	.description("Manage a Cloudflare account (login, domains, mail forwarding)");

// x cf login                          login by pasting credentials on stdin
// x cf login list | use <id> | remove <id>
const cfLogin = cf
	.command("login")
	.description(
		"Authenticate to Cloudflare — pick an API Token, or the email + Global API key.\n" +
			"Guided prompts in a terminal; piped secrets are auto-guessed.",
	)
	.action(commandCfLogin);

cfLogin
	.command("list")
	.description("List saved Cloudflare logins (marking the active one)")
	.action(commandCfLoginList);

cfLogin
	.command("use")
	.description("Switch which saved login is active")
	.argument("<id>", "Login id from `x cf login list`")
	.action(commandCfLoginUse);

cfLogin
	.command("remove")
	.description("Delete a saved login")
	.argument("<id>", "Login id from `x cf login list`")
	.action(commandCfLoginRemove);

cf.command("logout")
	.description("Clear the active Cloudflare login")
	.action(commandCfLogout);

// x cf domains list
const cfDomains = cf
	.command("domains")
	.description("Domains (zones) on the logged-in Cloudflare account");

cfDomains
	.command("list")
	.description("List all domains associated with the logged-in account")
	.action(commandCfDomainsList);

// x cf mailforwarding list | set <domain> [<destination>]
const cfMailforwarding = cf
	.command("mailforwarding")
	.description("Manage the catch-all mail forwarding rule of your domains");

cfMailforwarding
	.command("list")
	.description(
		"List each domain's mail forwarding target as <domain> -> <destination>",
	)
	.action(commandCfMailforwardingList);

cfMailforwarding
	.command("set")
	.description(
		"Set (or, without a destination, unset) a domain's mail forwarding. " +
			"Needs the destination to be a verified Email Routing address.",
	)
	.argument("<domain>", "Domain name, e.g. neau.pro")
	.argument(
		"[destination]",
		"Destination email to forward to; omit to unset the rule",
	)
	.action(commandCfMailforwardingSet);

program.parse();
