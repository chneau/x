#!/usr/bin/env bun
import { Command } from "commander";
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

program.parse();
