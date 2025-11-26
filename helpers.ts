import { $ } from "bun";

export const commandExists = async (cmd: string) => {
	if (process.platform === "win32") {
		return await $`powershell.exe -Command "Get-Command ${cmd}"`
			.quiet()
			.then((x) => x.exitCode === 0)
			.catch(() => false);
	}
	return (await $`which ${cmd}`.text().catch(() => "")).trim() !== "";
};

export const isRoot = async () => {
	const id = (await $`id -u`.text()).trim();
	return id === "0";
};

export const canSudo = async () => {
	const text = (await $`sudo echo 0`.text().catch(() => "")).trim();
	return text === "0";
};

export const getCurrentVersion = async () =>
	await Bun.file(`${import.meta.dir}/package.json`)
		.json()
		.then((x) => x.version as string)
		.catch(() => "UNKNOWN");
