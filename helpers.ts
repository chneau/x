import { $ } from "bun";

export const commandExists = async (cmd: string) =>
	(await $`which ${cmd}`.text().catch(() => "")).trim() !== "";

export const isRoot = async () => {
	const id = (await $`id -u`.text()).trim();
	return id === "0";
};

export const canSudo = async () => {
	const text = (await $`sudo echo 0`.text().catch(() => "")).trim();
	return text === "0";
};
