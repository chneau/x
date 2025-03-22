#!/usr/bin/env bun
import { program } from "commander";
import { command } from "./command";
import { commandDeploy } from "./commandDeploy";
import { commandDoctor } from "./commandDoctor";
import { commandFmt } from "./commandFmt";
import { commandSystem } from "./commandSystem";
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
	.argument("[file]", "File to deploy", ".x-deploy.json")
	.argument("filter", "Services to deploy", "*")
	.action(commandDeploy);

program
	.command("upgrade")
	.description("Uprade x to the latest version")
	.action(commandUpgrade);

program
	.command("system")
	.description("Update/install the system packages")
	.action(commandSystem);

program
	.command("doctor")
	.description("Check the system for issues")
	.action(commandDoctor);

program.parse();
