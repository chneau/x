import { $ } from "bun";
import z from "zod";

export const optionsSchema = z.object({
	email: z.email(),
	name: z.string().min(1),
	updates: z.boolean(),
});
export type DoctorOptions = z.infer<typeof optionsSchema>;

const checkGitConfig = async (key: string, expected: string) => {
	const current = (await $`git config --global ${key}`.nothrow().text()).trim();
	if (current === "") {
		console.log(`❌ Git ${key} is not set`);
		console.log(`🕒 Setting git ${key}`);
		await $`git config --global ${key} ${expected}`;
		console.log(`✅ Git ${key} set`);
	} else {
		console.log(`✅ Git ${key} is already set to "${current}"`);
	}
};

/** Entries kept in the global gitignore, one per line. */
const globalIgnoreEntries = [
	".antigravitycli",
	".serena",
	".reasonix",
	".agents",
	"skills-lock.json",
	".claude",
];

/**
 * Keep `~/.gitignore_global` in sync and point git at it, without ever dropping
 * lines that were added by hand: existing entries are kept, only missing ones
 * are appended.
 */
const doctorGlobalIgnore = async () => {
	const home = Bun.env.HOME || Bun.env.USERPROFILE;
	if (!home) return;

	const path = `${home}/.gitignore_global`;
	if (!(await Bun.file(path).exists())) {
		await Bun.write(path, "");
	}

	const missing: string[] = [];
	for (const entry of globalIgnoreEntries) {
		const present = await $`grep -Fxq ${entry} ${path}`.nothrow().quiet();
		if (present.exitCode !== 0) missing.push(entry);
	}

	if (missing.length > 0) {
		console.log(
			`🕒 Adding ${missing.length} entries to global gitignore: ${missing.join(
				", ",
			)}`,
		);
		const existing = await Bun.file(path).text();
		const trimmed = existing.trim();
		const prefix = trimmed === "" ? "" : `${trimmed}\n`;
		await Bun.write(path, `${prefix}${missing.join("\n")}\n`);
	} else {
		console.log("✅ Global gitignore is up to date");
	}

	await $`git config --global core.excludesfile ${path}`;
	console.log(`✅ Git excludesfile set to ${path}`);
};

export const doctorGitconfig = async (options: DoctorOptions) => {
	await checkGitConfig("user.name", options.name);
	await checkGitConfig("user.email", options.email);

	await $`git config --global url."ssh://git@github.com/".insteadOf "https://github.com/"`;
	await $`git config --global merge.ff false`;
	await $`git config --global pull.ff true`;
	await $`git config --global pull.rebase true`;
	await $`git config --global core.whitespace "blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol"`;
	await $`git config --global fetch.prune true`;

	await doctorGlobalIgnore();

	console.log("✅ Git config checked and updated.");
};

export const doctorSsh = async () => {
	const sshFile = `${Bun.env.HOME || Bun.env.USERPROFILE}/.ssh/id_rsa`;
	if (await Bun.file(sshFile).exists()) {
		console.log("✅ SSH key is set");
	} else {
		console.log("❌ SSH key is not set");
		console.log(
			'⚡ Please execute this command:\n\nssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -P ""',
		);
		throw new Error("❌ SSH key is not set");
	}
};

export const doctorSshPermissions = async () => {
	if (process.platform === "win32") return;
	const home = Bun.env.HOME;
	if (!home) return;

	try {
		const chmods: Array<[string, string]> = [
			[".ssh", "700"],
			[".ssh/id_rsa", "600"],
			[".ssh/id_rsa.pub", "644"],
			[".ssh/authorized_keys", "600"],
			[".ssh/config", "600"],
		];
		for (const [file, mode] of chmods) {
			if (await Bun.file(`${home}/${file}`).exists()) {
				await $`chmod ${mode} ${home}/${file}`.nothrow();
			}
		}
		console.log("✅ SSH permissions verified");
	} catch {
		console.log("⚠️ Could not verify/set SSH permissions");
	}
};

export const logDoctorStart = (
	platform: "Linux" | "Windows",
	options: DoctorOptions,
) => {
	console.log(`🔍 Running doctor (${platform})...`);
	console.log(
		"⚙️  email =",
		options.email,
		", name =",
		options.name,
		", updates =",
		options.updates,
	);
};

export const doctorInotify = async () => {
	if (process.platform === "win32") return;
	try {
		const watches = (
			await $`cat /proc/sys/fs/inotify/max_user_watches`
				.quiet()
				.nothrow()
				.text()
		).trim();
		const instances = (
			await $`cat /proc/sys/fs/inotify/max_user_instances`
				.quiet()
				.nothrow()
				.text()
		).trim();

		const watchesNum = Number.parseInt(watches, 10);
		const instancesNum = Number.parseInt(instances, 10);

		if (watchesNum < 524288 || instancesNum < 524288) {
			console.log("❌ inotify limits are below recommended values (524288)");
			console.log("🕒 Updating inotify limits in /etc/sysctl.conf...");
			await $`grep -Fxq "fs.inotify.max_user_watches=524288" /etc/sysctl.conf || echo "fs.inotify.max_user_watches=524288" | sudo tee -a /etc/sysctl.conf`.nothrow();
			await $`grep -Fxq "fs.inotify.max_user_instances=524288" /etc/sysctl.conf || echo "fs.inotify.max_user_instances=524288" | sudo tee -a /etc/sysctl.conf`.nothrow();
			await $`sudo sysctl -p`.nothrow();
			console.log("✅ inotify limits updated");
		} else {
			console.log("✅ inotify limits are configured properly");
		}
	} catch {}
};

export const doctorGithub = async () => {
	if (
		await $`ssh -T -o "StrictHostKeyChecking no" git@github.com 2>&1`
			.nothrow()
			.text()
			.then((x) => x.includes("successfully authenticated"))
	) {
		console.log("✅ SSH key is set on GitHub");
	} else {
		console.log("❌ SSH key is not set on GitHub");
		console.log("🕒 Adding SSH key to GitHub");
		if (await Bun.file(`${Bun.env.HOME}/.ssh/id_rsa.pub`).exists()) {
			const pubKey = await Bun.file(`${Bun.env.HOME}/.ssh/id_rsa.pub`).text();
			console.log(pubKey);
			console.log(
				"⚡ Go to https://github.com/settings/ssh/new and past the text above",
			);
		} else {
			console.log(
				"❌ ~/.ssh/id_rsa.pub not found. Please generate SSH key first.",
			);
		}
	}
};
