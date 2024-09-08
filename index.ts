#!/usr/bin/env bun
import { Command } from "commander";
import { commandDoctor } from "./commandDoctor";
import { commandSystem } from "./commandSystem";
import { commandUpdate } from "./commandUpdate";

const program = new Command();

const version = await Bun.file(`${import.meta.dir}/package.json`)
	.json()
	.then((x) => x.version as string)
	.catch(() => "UNKNOWN");

program.name("x").description("chneau's utility CLI").version(version);

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
