#!/usr/bin/env bun
import { program } from "commander";
import { command } from "./command";
import { commandDoctor } from "./commandDoctor";
import { commandSystem } from "./commandSystem";
import { commandUpdate } from "./commandUpdate";
import { getCurrentVersion } from "./helpers";

const version = await getCurrentVersion();

program.name("x").description("chneau's utility CLI").version(version);

program
	.option("-r, --recursive [number]", "Recursion level", Number.parseFloat)
	.argument("[dir]", "Directory to manage", ".")
	.action(command);

program
	.command("update")
	.description("Update x to the latest version")
	.action(commandUpdate);

program
	.command("system")
	.description("Update/install the system packages")
	.action(commandSystem);

program
	.command("doctor")
	.description("Check the system for issues")
	.action(commandDoctor);

program.parse();
