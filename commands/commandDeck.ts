import { c, die, formatBytes } from "../utils/helpers";
import { $ } from "../utils/verboseShell";

type SteamdeckOptions = {
	host?: string;
	sudoPassword?: string;
};

type CleanShortcutsOptions = SteamdeckOptions & {
	dryRun?: boolean;
	shortcutsPath?: string;
};

type UpdateOptions = SteamdeckOptions & {
	flatpaks?: boolean;
	os?: boolean;
	games?: boolean;
	decky?: boolean;
	system?: boolean;
};

const DEFAULT_HOST = "steamdeck";
const DEFAULT_STEAMAPPS_PATH = "/home/deck/.local/share/Steam/steamapps";
const DEFAULT_DECKY_BIN = "/home/deck/homebrew/services/PluginLoader";
const DEFAULT_DECKY_INSTALLER =
	"https://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/install_release.sh";

const SSH_OPTS = "-o ConnectTimeout=30 -o BatchMode=yes";

type SshResult = { exitCode: number; stdout: Buffer; stderr: Buffer };

/**
 * Run a remote command. `stdin` (e.g. a sudo password) is written to the ssh
 * process, so it never appears in the echoed command.
 */
const sshRun = async (
	host: string,
	cmd: string,
	timeoutSec = 60,
	stdin?: string,
): Promise<SshResult> => {
	console.log(`${c.dim}${c.gray}$ ssh ${host} ${cmd}${c.reset}`);
	const proc = Bun.spawn(
		["timeout", `${timeoutSec}s`, "ssh", ...SSH_OPTS.split(" "), host, cmd],
		{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
	);
	if (stdin !== undefined) proc.stdin.write(stdin);
	proc.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).arrayBuffer(),
		new Response(proc.stderr).arrayBuffer(),
		proc.exited,
	]);
	return {
		exitCode,
		stdout: Buffer.from(stdout),
		stderr: Buffer.from(stderr),
	};
};

/** Die unless an SSH connection to `host` succeeds. */
const ensureSsh = async (host: string) => {
	const testConn = await sshRun(host, "echo ok", 10);
	if (testConn.exitCode !== 0) {
		die(
			`❌ Cannot connect to ${host}. Make sure SSH is enabled on Steam Deck.`,
		);
	}
};

const sshText = async (host: string, cmd: string, timeoutSec = 60) => {
	const res = await sshRun(host, cmd, timeoutSec);
	if (res.exitCode !== 0) return "";
	return res.stdout.toString().trim();
};

/** Locate the shortcuts.vdf of whichever Steam account owns one. */
const findShortcutsPath = async (host: string) =>
	await sshText(
		host,
		"ls -d /home/deck/.local/share/Steam/userdata/*/config/shortcuts.vdf 2>/dev/null | head -n 1",
		20,
	);

/** Stream `content` into `remotePath` over ssh, backing up the previous file. */
const sshWriteFile = async (
	host: string,
	remotePath: string,
	content: Uint8Array,
) =>
	await $`echo -n ${Buffer.from(content).toString(
		"base64",
	)} | base64 -d | ssh ${SSH_OPTS} ${host} ${`cp ${remotePath} ${remotePath}.bak && cat > ${remotePath}`}`.nothrow();

// ── VDF Binary Reader & Parser ────────────────────────────────────────────────

type VDFEntry = {
	index: string;
	fields: Record<string, unknown>;
	/** Byte offset where this entry's field data starts (after the index string). */
	fieldsStart: number;
	/** Byte offset just past this entry (its object terminator included). */
	end: number;
};

type ParsedVdf = {
	entries: VDFEntry[];
	/** Offset where the first entry starts, i.e. past the `shortcuts` root key. */
	headerEnd: number;
	/** Offset of the `0x08` that closes the shortcuts list. */
	trailerStart: number;
};

const parseVdf = (buffer: Uint8Array): ParsedVdf => {
	const data = Buffer.from(buffer);
	let pos = 0;

	const readByte = () => {
		const b = data[pos];
		pos += 1;
		return b ?? 0;
	};

	const readCString = () => {
		const end = data.indexOf(0, pos);
		if (end === -1) return "";
		const s = data.subarray(pos, end).toString("utf-8");
		pos = end + 1;
		return s;
	};

	const readInt32 = () => {
		const val = data.readInt32LE(pos);
		pos += 4;
		return val;
	};

	const readInt64 = () => {
		const val = Number(data.readBigInt64LE(pos));
		pos += 8;
		return val;
	};

	const empty: ParsedVdf = { entries: [], headerEnd: 0, trailerStart: 0 };

	const readObject = (): Record<string, unknown> => {
		const obj: Record<string, unknown> = {};
		while (pos < data.length) {
			const typeByte = readByte();
			if (typeByte === 0x08) break; // end of object
			const key = readCString();
			if (typeByte === 0x00) {
				obj[key] = readObject();
			} else if (typeByte === 0x01) {
				obj[key] = readCString();
			} else if (typeByte === 0x02) {
				obj[key] = readInt32();
			} else if (typeByte === 0x03) {
				obj[key] = data.readFloatLE(pos);
				pos += 4;
			} else if (typeByte === 0x07) {
				obj[key] = readInt64();
			} else {
				// Bail out rather than desync and corrupt the file on write-back.
				throw new Error(`unsupported VDF type 0x${typeByte.toString(16)}`);
			}
		}
		return obj;
	};

	if (data.length === 0 || readByte() !== 0x00) return empty;
	const rootKey = readCString();
	if (rootKey !== "shortcuts") return empty;
	const headerEnd = pos;

	const entries: VDFEntry[] = [];
	while (pos < data.length) {
		const typeByte = readByte();
		if (typeByte !== 0x00) break; // 0x08 ends the list
		const index = readCString();
		const fieldsStart = pos;
		const fields = readObject();
		entries.push({ index, fields, fieldsStart, end: pos });
	}

	// The byte right after the last entry is the `0x08` closing the list.
	return {
		entries,
		headerEnd,
		trailerStart: entries.at(-1)?.end ?? headerEnd,
	};
};

/**
 * Rebuild the file with `keep` entries, renumbered from 0. Every field byte is
 * copied verbatim from `original`, so types this parser cannot interpret survive.
 */
const rebuildVdf = (
	original: Uint8Array,
	parsed: ParsedVdf,
	keep: VDFEntry[],
): Buffer => {
	const data = Buffer.from(original);
	const chunks: Buffer[] = [data.subarray(0, parsed.headerEnd)];
	keep.forEach((entry, i) => {
		chunks.push(Buffer.from([0x00]));
		chunks.push(Buffer.from(`${i}`, "utf-8"));
		chunks.push(Buffer.from([0x00]));
		chunks.push(data.subarray(entry.fieldsStart, entry.end));
	});
	chunks.push(data.subarray(parsed.trailerStart));
	return Buffer.concat(chunks);
};

const parseExe = (raw: string): string => {
	const trimmed = raw.trim();
	if (trimmed.startsWith('"')) {
		const match = trimmed.match(/^"([^"]+)"/);
		if (match?.[1]) return match[1];
	}
	return trimmed.split(/\s+/)[0] ?? "";
};

const isSystemLauncher = (exe: string): boolean =>
	exe.startsWith("/usr/bin/flatpak") ||
	exe === "steamos-nested-desktop" ||
	!exe.startsWith("/");

// ── Command: clean-shortcuts ──────────────────────────────────────────────────

export const commandCleanShortcuts = async (options: CleanShortcutsOptions) => {
	const host = options.host || DEFAULT_HOST;

	console.log(`🔍 Checking Steam Deck (${host}) for broken shortcuts...`);

	await ensureSsh(host);

	const shortcutsPath =
		options.shortcutsPath || (await findShortcutsPath(host));
	if (!shortcutsPath) {
		die(
			"❌ Could not locate shortcuts.vdf on the Steam Deck.",
			"Pass --shortcuts-path <path> to point at it explicitly.",
		);
	}

	const rawShortcuts = await sshRun(host, `cat ${shortcutsPath}`, 30);
	if (rawShortcuts.exitCode !== 0) {
		die(`❌ Cannot read shortcuts from ${shortcutsPath}`);
	}

	let parsed: ParsedVdf;
	try {
		parsed = parseVdf(rawShortcuts.stdout);
	} catch (error) {
		die(
			"❌ Could not parse shortcuts.vdf — nothing was changed.",
			error instanceof Error ? error.message : String(error),
		);
	}
	const entries = parsed.entries;
	if (entries.length === 0) {
		console.log("No shortcuts found.");
		return;
	}

	console.log(`Found ${entries.length} non-Steam shortcuts. Checking files...`);

	const broken: VDFEntry[] = [];
	const good: VDFEntry[] = [];

	for (const entry of entries) {
		const name = String(entry.fields.AppName ?? entry.fields.appname ?? "?");
		const exeRaw = String(entry.fields.Exe ?? entry.fields.exe ?? "");
		const exe = parseExe(exeRaw);

		let exists = false;
		if (isSystemLauncher(exe)) {
			exists = true;
		} else {
			const res = await sshRun(
				host,
				`test -e "${exe.replace(/"/g, '\\"')}"`,
				15,
			);
			exists = res.exitCode === 0;
		}

		if (exists) {
			good.push(entry);
			console.log(`  ✅ [OK] ${name} -> ${exe}`);
		} else {
			broken.push(entry);
			console.log(`  ❌ [BROKEN] ${name} -> ${exe}`);
		}
	}

	if (broken.length === 0) {
		console.log("🎉 All shortcuts are healthy. Nothing to clean!");
		return;
	}

	console.log(`\nFound ${broken.length} broken shortcuts.`);

	if (options.dryRun) {
		console.log("ℹ️  --dry-run: No changes made.");
		return;
	}

	const newData = rebuildVdf(rawShortcuts.stdout, parsed, good);
	console.log(`Writing updated shortcuts to ${shortcutsPath}...`);

	const writeRes = await sshWriteFile(host, shortcutsPath, newData);
	if (writeRes.exitCode !== 0) {
		die("❌ Failed to write updated shortcuts.vdf");
	}

	console.log(
		`🎉 Removed ${broken.length} broken shortcut(s). Backup saved to ${shortcutsPath}.bak`,
	);
	console.log("Restart Steam on the Steam Deck to apply changes.");
};

// ── Command: disk ─────────────────────────────────────────────────────────────

export const commandDeckDisk = async (options: SteamdeckOptions) => {
	const host = options.host || DEFAULT_HOST;
	console.log(`🔍 Inspecting disk usage on ${host}...`);

	const dfOut = await sshText(
		host,
		"df -k --output=source,fstype,size,used,avail,target | grep -v tmpfs | grep -v devtmpfs",
		30,
	);

	if (!dfOut) {
		die(
			`❌ Cannot connect to ${host}. Make sure the Deck is awake and SSH is enabled.`,
		);
	}

	console.log("\n=== Filesystem Overview ===");
	console.log(dfOut);

	console.log("\n=== Category Breakdown ===");
	// Each path is measured separately (later entries overlap earlier ones).
	const categories = [
		{ name: "Steam Games", path: "/home/deck/.local/share/Steam/steamapps" },
		{ name: "Flatpaks", path: "/home/deck/.var/app /var/lib/flatpak" },
		{ name: "Home Dir", path: "/home/deck" },
		{ name: "Var", path: "/var" },
	];

	for (const cat of categories) {
		const out = await sshText(host, `du -sk ${cat.path} 2>/dev/null | tail -1`);
		const kb = Number.parseInt(out.split(/\s+/)[0] || "0", 10);
		if (kb > 0) {
			console.log(`  • ${cat.name.padEnd(16)}: ${formatBytes(kb * 1024)}`);
		}
	}

	console.log("\n=== Top Directories in /home/deck (excl. steamapps) ===");
	const topHome = await sshText(
		host,
		"du -k --max-depth=3 /home/deck 2>/dev/null | grep -v '/home/deck/.local/share/Steam/steamapps' | sort -rn | head -15",
	);
	console.log(topHome || "None");

	console.log("\n=== Largest Individual Files (>100M excl. steamapps) ===");
	const topFiles = await sshText(
		host,
		"find /home/deck /var -xdev -type f -size +100M 2>/dev/null | grep -v '/home/deck/.local/share/Steam/steamapps' | xargs -I{} du -k {} 2>/dev/null | sort -rn | head -10",
		60,
	);
	console.log(topFiles || "None");
};

// ── Command: update ───────────────────────────────────────────────────────────

export const commandDeck = async (options: UpdateOptions) => {
	const host = options.host || DEFAULT_HOST;
	const sudoPassword = options.sudoPassword;

	console.log(`🚀 Starting Steam Deck updater for ${host}...`);

	await ensureSsh(host);

	// 1. Flatpaks
	if (options.flatpaks !== false) {
		console.log("\n── Flatpak / Discover Apps ──");
		const pendingFlatpaks = await sshText(
			host,
			"flatpak remote-ls --updates 2>/dev/null",
			30,
		);
		if (!pendingFlatpaks) {
			console.log("✅ Flatpaks are up to date.");
		} else {
			console.log("Updating Flatpaks...");
			// `sudo -S` reads the password from ssh stdin, so it is never echoed.
			const cmd = sudoPassword
				? "flatpak update --user -y; sudo -S flatpak update --system -y"
				: "flatpak update --user -y";
			const res = await sshRun(
				host,
				cmd,
				300,
				sudoPassword ? `${sudoPassword}\n` : undefined,
			);
			if (res.exitCode === 0) {
				console.log("✅ Flatpaks updated.");
			} else {
				console.log(`⚠️ Flatpak update finished with code ${res.exitCode}.`);
			}
		}
	}

	// 2. SteamOS
	if (options.os !== false) {
		console.log("\n── SteamOS System Update ──");
		const check = await sshRun(host, "steamos-update check 2>&1", 60);
		if (check.exitCode === 1) {
			console.log("✅ SteamOS is up to date.");
		} else if (check.exitCode === 0) {
			console.log("Applying SteamOS update...");
			const apply = await sshRun(host, "steamos-update 2>&1", 300);
			if (apply.exitCode === 0 || apply.exitCode === 1) {
				console.log("✅ SteamOS update complete. Reboot Deck to apply.");
			} else {
				console.log(`⚠️ steamos-update exited with code ${apply.exitCode}.`);
			}
		} else {
			console.log(`⚠️ Unexpected steamos-update exit code ${check.exitCode}.`);
		}
	}

	// 3. Steam Games / Runtimes pending
	if (options.games !== false) {
		console.log("\n── Steam Games & Runtimes ──");
		const rawManifests = await sshText(
			host,
			`cat ${DEFAULT_STEAMAPPS_PATH}/appmanifest_*.acf 2>/dev/null | awk '/^"AppState"/{if(buf) print buf; buf=""} {buf=buf $0 "\\n"} END{if(buf) print buf}'`,
			30,
		);

		const pendingGames: Array<{
			name: string;
			appid: string;
			remaining: number;
		}> = [];
		const blocks = rawManifests.split(/(?="AppState")/);
		for (const block of blocks) {
			const appidMatch = block.match(/"appid"\s+"([^"]*)"/);
			const nameMatch = block.match(/"name"\s+"([^"]*)"/);
			const toDlMatch = block.match(/"BytesToDownload"\s+"([^"]*)"/);
			const doneDlMatch = block.match(/"BytesDownloaded"\s+"([^"]*)"/);
			const toStMatch = block.match(/"BytesToStage"\s+"([^"]*)"/);
			const doneStMatch = block.match(/"BytesStaged"\s+"([^"]*)"/);

			if (appidMatch && nameMatch && appidMatch[1] && nameMatch[1]) {
				const toDl = Number.parseInt(toDlMatch?.[1] || "0", 10);
				const doneDl = Number.parseInt(doneDlMatch?.[1] || "0", 10);
				const toSt = Number.parseInt(toStMatch?.[1] || "0", 10);
				const doneSt = Number.parseInt(doneStMatch?.[1] || "0", 10);
				const remaining = toDl - doneDl + (toSt - doneSt);
				if (remaining > 0) {
					pendingGames.push({
						name: nameMatch[1],
						appid: appidMatch[1],
						remaining,
					});
				}
			}
		}

		if (pendingGames.length === 0) {
			console.log("✅ All games and runtimes are up to date.");
		} else {
			console.log(`Found ${pendingGames.length} pending downloads:`);
			for (const g of pendingGames) {
				console.log(
					`  • ${g.name} (${g.appid}) -> ${formatBytes(g.remaining)} remaining`,
				);
			}
		}
	}

	// 4. Decky Loader
	if (options.decky !== false) {
		console.log("\n── Decky Loader ──");
		const exists =
			(await sshRun(host, `test -f ${DEFAULT_DECKY_BIN}`, 10)).exitCode === 0;
		if (!exists) {
			console.log("Decky not installed. Skipping.");
		} else {
			const localVer = await sshText(
				host,
				"cat /home/deck/homebrew/services/.loader.version 2>/dev/null",
			);
			const latestVer = await sshText(
				host,
				'curl -sf https://api.github.com/repos/SteamDeckHomebrew/decky-loader/releases/latest | grep -o \'"tag_name": "[^"]*\' | cut -d\'"\' -f4',
			);
			console.log(
				`Installed: ${localVer || "unknown"} | Latest: ${
					latestVer || "unknown"
				}`,
			);

			if (localVer && latestVer && localVer === latestVer) {
				console.log("✅ Decky Loader is up to date.");
			} else {
				console.log("Updating Decky Loader...");
				// Prime the sudo credential cache via stdin, then install.
				const installCmd = sudoPassword
					? `sudo -S true 2>/dev/null && curl -sL ${DEFAULT_DECKY_INSTALLER} | sudo -S sh 2>&1`
					: `curl -sL ${DEFAULT_DECKY_INSTALLER} | sudo -S sh 2>&1`;
				const res = await sshRun(
					host,
					installCmd,
					120,
					sudoPassword ? `${sudoPassword}\n` : undefined,
				);
				if (res.exitCode === 0) {
					console.log("✅ Decky updated.");
				} else {
					console.log(`⚠️ Decky installer exited with code ${res.exitCode}.`);
				}
			}
		}
	}

	console.log("\n🎉 Steam Deck update finished.");
};
