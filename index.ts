#!/usr/bin/env bun
import "./verboseShell";
import { program } from "commander";
import { command } from "./command";
import { commandCleanPrs } from "./commandCleanPrs";
import { commandDeploy } from "./commandDeploy";
import { commandDoctor } from "./commandDoctor";
import { commandFmt } from "./commandFmt";
import { commandHelm } from "./commandHelm";
import { commandNew } from "./commandNew";
import { commandUpgrade } from "./commandUpgrade";
import config from "./config.json";
import { getCurrentVersion } from "./helpers";

const version = await getCurrentVersion();

program.name("x").description("chneau's utility CLI").version(version);

program
	.option("-r, --recursive [number]", "Recursion level", Number.parseFloat)
	.argument("[dir]", "Directory to manage", ".")
	.action(command);

program.command("fmt").description("Format all files").action(commandFmt);

program
	.command("clean-prs")
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
	.action(commandCleanPrs);

program
	.command("deploy")
	.description("Deploy to kubernetes")
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
	.description("Upgrade x to the latest version")
	.action(commandUpgrade);

program
	.command("doctor")
	.description("Check the system for issues")
	.option("-e, --email <email>", "Git email", config.git.defaultEmail)
	.option("-n, --name <name>", "Git name", config.git.defaultName)
	.option("--no-updates", "Skip system updates")
	.action(commandDoctor);

program
	.command("new")
	.description("Create new bun project")
	.option("-t, --template <template-name>", "Template name or git repo")
	.action(commandNew);

program.parse();
