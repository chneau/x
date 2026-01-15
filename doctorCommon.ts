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

export const doctorGitconfig = async (options: DoctorOptions) => {
	await checkGitConfig("user.name", options.name);
	await checkGitConfig("user.email", options.email);

	// Set other configurations
	await $`git config --global url."ssh://git@github.com/".insteadOf "https://github.com/"`;
	await $`git config --global merge.ff false`;
	await $`git config --global pull.ff true`;
	await $`git config --global pull.rebase true`;
	await $`git config --global core.whitespace "blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol"`;
	await $`git config --global fetch.prune true`;

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
