#!/usr/bin/env bun
import { type ParseArgsConfig, parseArgs } from "node:util";
import { commandBootstrap } from "./commands/commandBootstrap";
import {
  commandCfDomainsList,
  commandCfLogin,
  commandCfLoginList,
  commandCfLoginRemove,
  commandCfLoginUse,
  commandCfLogout,
  commandCfMailforwardingList,
  commandCfMailforwardingSet,
} from "./commands/commandCf";
import {
  commandCleanShortcuts,
  commandDeck,
  commandDeckDisk,
} from "./commands/commandDeck";
import { commandDeploy } from "./commands/commandDeploy";
import { commandDisk } from "./commands/commandDisk";
import { commandDiskWindows } from "./commands/commandDiskWindows";
import { commandDoctor } from "./commands/commandDoctor";
import { commandFmt } from "./commands/commandFmt";
import { commandGitclean } from "./commands/commandGitclean";
import { commandHelm } from "./commands/commandHelm";
import { commandKclean } from "./commands/commandKclean";
import { commandNew } from "./commands/commandNew";
import { commandPrs } from "./commands/commandPrs";
import { commandPurify } from "./commands/commandPurify";
import { commandPyup } from "./commands/commandPyup";
import { commandUpgrade } from "./commands/commandUpgrade";
import config from "./config.json";
import { getCurrentVersion } from "./utils/helpers";

const helpText = (version: string) => `x v${version} — chneau's utility CLI

Usage: x <command> [options]

Commands:
  gitclean [dir]          Prune, repack, fetch prune, and clean git repos
  purify [dir]            Sanitize & modernize project configuration
  fmt | format            Format code across all supported languages
  prs [clean]             Manage GitHub pull requests
  deck [shortcuts|disk|update]  Manage, clean, and update Steam Deck
  deploy [files...]       Deploy Kubernetes manifests to cluster
  helm [releases...]      Manage and upgrade Helm charts
  kclean                  Clean zero-replica ReplicaSets and failed/succeeded Pods
  upgrade                 Upgrade x CLI to the latest version
  disk                    Analyze disk space usage and clean caches
  disk-windows            Analyze disk space usage and clean caches in Windows
  doctor                  Diagnose and repair dev environment & git configs
  new [dir]               Scaffold and initialize a new project
  pyup [dir]              Make Python files uv scripts with Python 3.14
  bootstrap               Clone/pull chneau/dotfiles and run bootstrap
  cf <subcommand>         Manage Cloudflare (login, logout, domains, mailforwarding)`;

const main = async () => {
  const [cmd, ...rest] = Bun.argv.slice(2);

  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(helpText(await getCurrentVersion()));
    process.exit(0);
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(await getCurrentVersion());
    process.exit(0);
  }

  const die = (msg: string): never => {
    console.error(msg);
    process.exit(1);
  };

  const parseIntOpt = (
    value: string | undefined,
    fallback: number,
    message: string,
    min: number,
    max = Number.MAX_SAFE_INTEGER,
  ) => {
    if (value === undefined) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < min || parsed > max) die(message);
    return parsed;
  };

  const parse = <T extends ParseArgsConfig["options"]>(
    args: string[],
    options: T,
  ) => parseArgs({ args, options, allowPositionals: true });

  switch (cmd) {
    case "gitclean": {
      const { values, positionals } = parse(rest, {
        recursive: { type: "string", short: "r" },
        concurrency: { type: "string", short: "c" },
        "dry-run": { type: "boolean", short: "d", default: false },
      });
      await commandGitclean(positionals[0] ?? ".", {
        recursive: parseIntOpt(
          values.recursive as string | undefined,
          1,
          "Recursion depth must be a non-negative integer",
          0,
        ),
        concurrency: parseIntOpt(
          values.concurrency as string | undefined,
          10,
          "Concurrency must be a positive integer",
          1,
        ),
        dryRun: Boolean(values["dry-run"]),
      });
      break;
    }
    case "purify": {
      const { values, positionals } = parse(rest, {
        recursive: { type: "string", short: "r" },
        "dry-run": { type: "boolean", short: "d", default: false },
      });
      await commandPurify(positionals[0] ?? ".", {
        recursive: parseIntOpt(
          values.recursive as string | undefined,
          0,
          "Recursion level must be an integer between 0 and 4",
          0,
          4,
        ),
        dryRun: Boolean(values["dry-run"]),
      });
      break;
    }
    case "fmt":
    case "format": {
      const { values } = parse(rest, {
        check: { type: "boolean", short: "c", default: false },
      });
      await commandFmt({ check: Boolean(values.check) });
      break;
    }
    case "prs": {
      const sub = rest[0] === "clean" ? rest.slice(1) : rest;
      const { values } = parse(sub, {
        owner: { type: "string", short: "o" },
        concurrency: { type: "string", short: "c" },
        "dry-run": { type: "boolean", short: "d", default: false },
      });
      await commandPrs({
        owner: values.owner as string | undefined,
        concurrency:
          values.concurrency !== undefined
            ? parseIntOpt(
                values.concurrency as string,
                1,
                "Concurrency must be a positive integer",
                1,
              )
            : undefined,
        dryRun: Boolean(values["dry-run"]),
      });
      break;
    }
    case "deck": {
      const [sub, ...subRest] = rest;
      if (sub === "shortcuts") {
        const { values } = parse(subRest, {
          host: { type: "string", short: "H", default: "steamdeck" },
          "shortcuts-path": { type: "string", short: "p" },
          "dry-run": { type: "boolean", short: "d", default: false },
        });
        await commandCleanShortcuts({
          host: String(values.host),
          shortcutsPath: values["shortcuts-path"] as string | undefined,
          dryRun: Boolean(values["dry-run"]),
        });
      } else if (sub === "disk") {
        const { values } = parse(subRest, {
          host: { type: "string", short: "H", default: "steamdeck" },
        });
        await commandDeckDisk({ host: String(values.host) });
      } else {
        const args = sub === "update" ? subRest : rest;
        const { values } = parse(args, {
          host: { type: "string", short: "H", default: "steamdeck" },
          "sudo-password": { type: "string", short: "s" },
          "no-flatpaks": { type: "boolean", default: false },
          "no-os": { type: "boolean", default: false },
          "no-games": { type: "boolean", default: false },
          "no-decky": { type: "boolean", default: false },
        });
        await commandDeck({
          host: String(values.host),
          sudoPassword: values["sudo-password"] as string | undefined,
          flatpaks: !values["no-flatpaks"],
          os: !values["no-os"],
          games: !values["no-games"],
          decky: !values["no-decky"],
        });
      }
      break;
    }
    case "deploy": {
      const { values, positionals } = parse(rest, {
        "dry-run": { type: "boolean", short: "d", default: false },
        "print-yaml": { type: "boolean", short: "p", default: false },
      });
      await commandDeploy(positionals, {
        dryRun: Boolean(values["dry-run"]),
        printYaml: Boolean(values["print-yaml"]),
      });
      break;
    }
    case "helm": {
      const { values, positionals } = parse(rest, {
        upgrade: { type: "boolean", short: "u", default: false },
        all: { type: "boolean", short: "a", default: false },
      });
      await commandHelm(positionals, {
        upgrade: Boolean(values.upgrade),
        all: Boolean(values.all),
      });
      break;
    }
    case "kclean": {
      const { values } = parse(rest, {
        "all-namespaces": { type: "boolean", short: "A", default: false },
        "all-contexts": { type: "boolean", short: "C", default: false },
        yes: { type: "boolean", short: "y", default: false },
      });
      await commandKclean({
        allNamespaces: Boolean(values["all-namespaces"]),
        allContexts: Boolean(values["all-contexts"]),
        yes: Boolean(values.yes),
      });
      break;
    }
    case "upgrade":
      await commandUpgrade();
      break;
    case "disk":
    case "disk-windows": {
      const { values } = parse(rest, {
        clean: { type: "boolean", short: "c", default: false },
        "dry-run": { type: "boolean", short: "d", default: false },
        top: { type: "string", short: "t" },
      });
      const opts = {
        clean: Boolean(values.clean),
        dryRun: Boolean(values["dry-run"]),
        top: parseIntOpt(
          values.top as string | undefined,
          15,
          "Top count must be a positive integer",
          1,
        ),
      };
      await (cmd === "disk" ? commandDisk(opts) : commandDiskWindows(opts));
      break;
    }
    case "doctor": {
      const { values } = parse(rest, {
        email: { type: "string", short: "e", default: config.git.defaultEmail },
        name: { type: "string", short: "n", default: config.git.defaultName },
        "no-updates": { type: "boolean", default: false },
      });
      await commandDoctor({
        email: String(values.email),
        name: String(values.name),
        updates: !values["no-updates"],
      });
      break;
    }
    case "new": {
      const { values, positionals } = parse(rest, {
        template: { type: "string", short: "t" },
        "list-templates": { type: "boolean", short: "l", default: false },
        force: { type: "boolean", short: "f", default: false },
      });
      await commandNew(positionals[0] ?? ".", {
        template: values.template as string | undefined,
        listTemplates: Boolean(values["list-templates"]),
        force: Boolean(values.force),
      });
      break;
    }
    case "pyup": {
      const { values, positionals } = parse(rest, {
        "dry-run": { type: "boolean", short: "d", default: false },
        check: { type: "boolean", default: false },
      });
      await commandPyup(positionals[0] ?? ".", {
        dryRun: Boolean(values["dry-run"]),
        check: Boolean(values.check),
      });
      break;
    }
    case "bootstrap":
      await commandBootstrap();
      break;
    case "cf": {
      const [sub, sub2, ...subRest] = rest;
      if (sub === "login") {
        if (sub2 === "list") await commandCfLoginList();
        else if (sub2 === "use" && subRest[0])
          await commandCfLoginUse(subRest[0]);
        else if (sub2 === "remove" && subRest[0]) {
          await commandCfLoginRemove(subRest[0]);
        } else await commandCfLogin();
      } else if (sub === "logout") {
        await commandCfLogout();
      } else if (sub === "domains" && sub2 === "list") {
        await commandCfDomainsList();
      } else if (sub === "mailforwarding") {
        if (sub2 === "list") await commandCfMailforwardingList();
        else if (sub2 === "set" && subRest[0]) {
          await commandCfMailforwardingSet(subRest[0], subRest[1]);
        } else die("Usage: x cf mailforwarding <list|set <domain> [dest]>");
      } else {
        die("Usage: x cf <login|logout|domains list|mailforwarding>");
      }
      break;
    }
    default:
      die(`Unknown command: ${cmd}\nRun 'x --help' for usage.`);
  }
};

void main();
