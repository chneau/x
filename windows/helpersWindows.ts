import { $ } from "bun";

export const commandExists = async (cmd: string) => {
	try {
		const result = await $`where ${cmd}`.quiet();
		return result.exitCode === 0;
	} catch {
		return false;
	}
};

export const isAdmin = async () => {
	try {
		const result = await $`net session`.quiet();
		return result.exitCode === 0;
	} catch {
		return false;
	}
};
