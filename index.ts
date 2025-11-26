#!/usr/bin/env bun
import { program } from "commander";
import { command } from "./command";
import { commandDeploy } from "./commandDeploy";
import { commandDoctor } from "./commandDoctor";
import { commandFmt } from "./commandFmt";
import { commandUpgrade } from "./commandUpgrade";
import { getCurrentVersion } from "./helpers";

const version = await getCurrentVersion();

program.name("x").description("chneau's utility CLI").version(version);

program
	.option("-r, --recursive [number]", "Recursion level", Number.parseFloat)
	.argument("[dir]", "Directory to manage", ".")
	.action(command);

program.command("fmt").description("Format all files").action(commandFmt);

program
	.command("deploy")
	.description("Deploy to kubernetes")
	.allowExcessArguments()
	.action(commandDeploy);

program
	.command("upgrade")
	.description("Uprade x to the latest version")
	.action(commandUpgrade);

program
	.command("doctor")
	.description("Check the system for issues")
	.option("-e, --email <email>", "Git email", "charles63500@gmail.com")
	.option("-n, --name <name>", "Git name", "chneau")
	.option("--no-updates", "Skip system updates")
	.action(commandDoctor);

program.parse();
