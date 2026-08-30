import { $ } from "bun";

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
const DEFAULT_SHORTCUTS_PATH =
	"/home/deck/.local/share/Steam/userdata/56154729/config/shortcuts.vdf";
const DEFAULT_STEAMAPPS_PATH = "/home/deck/.local/share/Steam/steamapps";
const DEFAULT_DECKY_BIN = "/home/deck/homebrew/services/PluginLoader";
const DEFAULT_DECKY_INSTALLER =
	"https://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/install_release.sh";

const sshRun = async (host: string, cmd: string, timeoutSec = 60) =>
	await $`timeout ${timeoutSec}s ssh -o ConnectTimeout=30 -o BatchMode=yes ${host} ${cmd}`
		.quiet()
		.nothrow();

const sshText = async (host: string, cmd: string, timeoutSec = 60) =>
	(
		await $`timeout ${timeoutSec}s ssh -o ConnectTimeout=30 -o BatchMode=yes ${host} ${cmd}`
			.quiet()
			.text()
	).trim();

const humanBytes = (n: number) => {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = n;
	for (const unit of units) {
		if (size < 1024) {
			return `${size.toFixed(size < 10 && unit !== "B" ? 1 : 0)} ${unit}`;
		}
		size /= 1024;
	}
	return `${size.toFixed(1)} PB`;
};

// ── VDF Binary Reader & Parser ────────────────────────────────────────────────

type VDFEntry = {
	index: string;
	fields: Record<string, unknown>;
};

const parseVdf = (buffer: Uint8Array): VDFEntry[] => {
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
			} else if (typeByte === 0x07) {
				obj[key] = readInt64();
			}
		}
		return obj;
	};

	if (data.length === 0 || readByte() !== 0x00) return [];
	const rootKey = readCString();
	if (rootKey !== "shortcuts") return [];

	const entries: VDFEntry[] = [];
	while (pos < data.length) {
		const typeByte = readByte();
		if (typeByte === 0x08) break;
		if (typeByte !== 0x00) break;
		const index = readCString();
		const fields = readObject();
		entries.push({ index, fields });
	}

	return entries;
};

const dumpVdf = (entries: VDFEntry[]): Buffer => {
	const chunks: Buffer[] = [];

	const writeStr = (s: string) => {
		chunks.push(Buffer.from(s, "utf-8"));
		chunks.push(Buffer.from([0x00]));
	};

	const writeObject = (obj: Record<string, unknown>) => {
		for (const [key, value] of Object.entries(obj)) {
			if (value && typeof value === "object" && !Array.isArray(value)) {
				chunks.push(Buffer.from([0x00]));
				writeStr(key);
				writeObject(value as Record<string, unknown>);
			} else if (typeof value === "string") {
				chunks.push(Buffer.from([0x01]));
				writeStr(key);
				writeStr(value);
			} else if (typeof value === "number") {
				if (Math.abs(value) > 0x7fffffff) {
					chunks.push(Buffer.from([0x07]));
					writeStr(key);
					const buf = Buffer.alloc(8);
					buf.writeBigInt64LE(BigInt(value));
					chunks.push(buf);
				} else {
					chunks.push(Buffer.from([0x02]));
					writeStr(key);
					const buf = Buffer.alloc(4);
					buf.writeInt32LE(value);
					chunks.push(buf);
				}
			}
		}
		chunks.push(Buffer.from([0x08]));
	};

	// root
	chunks.push(Buffer.from([0x00]));
	writeStr("shortcuts");

	entries.forEach((entry, i) => {
		chunks.push(Buffer.from([0x00]));
		writeStr(String(i));
		writeObject(entry.fields);
	});

	chunks.push(Buffer.from([0x08])); // end shortcuts
	chunks.push(Buffer.from([0x08])); // end root

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
	const shortcutsPath = options.shortcutsPath || DEFAULT_SHORTCUTS_PATH;

	console.log(`🔍 Checking Steam Deck (${host}) for broken shortcuts...`);

	const testConn = await sshRun(host, "echo ok", 10);
	if (testConn.exitCode !== 0) {
		console.error(
			`❌ Cannot connect to ${host}. Make sure SSH is enabled on Steam Deck.`,
		);
		process.exit(1);
	}

	const rawShortcuts =
		await $`timeout 30s ssh -o ConnectTimeout=30 -o BatchMode=yes ${host} "cat ${shortcutsPath}"`
			.quiet()
			.nothrow();

	if (rawShortcuts.exitCode !== 0) {
		console.error(`❌ Cannot read shortcuts from ${shortcutsPath}`);
		process.exit(1);
	}

	const entries = parseVdf(new Uint8Array(rawShortcuts.stdout));
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

	const newData = dumpVdf(good);
	console.log(`Writing updated shortcuts to ${shortcutsPath}...`);

	const proc = Bun.spawn(
		[
			"ssh",
			"-o",
			"ConnectTimeout=30",
			"-o",
			"BatchMode=yes",
			host,
			`cp ${shortcutsPath} ${shortcutsPath}.bak && cat > ${shortcutsPath}`,
		],
		{
			stdin: newData,
		},
	);
	const writeExit = await proc.exited;

	if (writeExit !== 0) {
		console.error("❌ Failed to write updated shortcuts.vdf");
		process.exit(1);
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
		console.error(
			`❌ Cannot connect to ${host}. Make sure the Deck is awake and SSH is enabled.`,
		);
		process.exit(1);
	}

	console.log("\n=== Filesystem Overview ===");
	console.log(dfOut);

	console.log("\n=== Category Breakdown ===");
	const categories = [
		{
			name: "Steam Games",
			path: "/home/deck/.local/share/Steam/steamapps",
		},
		{
			name: "Steam Runtime",
			path: "/home/deck/.local/share/Steam",
		},
		{
			name: "Flatpaks",
			path: "/home/deck/.var/app /var/lib/flatpak",
		},
		{
			name: "Home Dir",
			path: "/home/deck",
		},
		{
			name: "Var",
			path: "/var",
		},
	];

	for (const cat of categories) {
		const out = await sshText(host, `du -sk ${cat.path} 2>/dev/null | tail -1`);
		const kb = parseInt(out.split(/\s+/)[0] || "0", 10);
		if (kb > 0) {
			console.log(`  • ${cat.name.padEnd(16)}: ${humanBytes(kb * 1024)}`);
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

	const testConn = await sshRun(host, "echo ok", 10);
	if (testConn.exitCode !== 0) {
		console.error(
			`❌ Cannot connect to ${host}. Make sure SSH is enabled on Steam Deck.`,
		);
		process.exit(1);
	}

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
			let cmd = "flatpak update --user -y";
			if (sudoPassword) {
				cmd += `; echo ${JSON.stringify(
					sudoPassword,
				)} | sudo -S flatpak update --system -y`;
			}
			const res = await sshRun(host, cmd, 300);
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
				const toDl = parseInt(toDlMatch?.[1] || "0", 10);
				const doneDl = parseInt(doneDlMatch?.[1] || "0", 10);
				const toSt = parseInt(toStMatch?.[1] || "0", 10);
				const doneSt = parseInt(doneStMatch?.[1] || "0", 10);
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
					`  • ${g.name} (${g.appid}) -> ${humanBytes(g.remaining)} remaining`,
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
				let installCmd = `curl -sL ${DEFAULT_DECKY_INSTALLER} | sudo -S sh 2>&1`;
				if (sudoPassword) {
					installCmd = `echo ${JSON.stringify(
						sudoPassword,
					)} | sudo -S true 2>/dev/null && curl -sL ${DEFAULT_DECKY_INSTALLER} | sudo -S sh 2>&1`;
				}
				const res = await sshRun(host, installCmd, 120);
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
