#!/usr/bin/env bun
import { Command } from "commander";

const program = new Command();

const version = await Bun.file(`${import.meta.dir}/package.json`)
	.json()
	.then((x) => x.version);

program //
	.name("x")
	.description("chneau's utility CLI")
	.version(version);

program.parse();
