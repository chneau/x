import { $ } from "bun";

export const commandExists = async (cmd: string) => {
	const shell =
		process.platform === "win32"
			? $`powershell.exe -Command "Get-Command ${cmd}"`
			: $`which ${cmd}`;
	return await shell
		.quiet()
		.then((x) => x.exitCode === 0)
		.catch(() => false);
};

export const isRoot = async () => (await $`id -u`.text()).trim() === "0";

export const canSudo = async () =>
	await $`sudo -n true`
		.quiet()
		.then((x) => x.exitCode === 0)
		.catch(() => false);

export const getCurrentVersion = async () =>
	await Bun.file(`${import.meta.dir}/package.json`)
		.json()
		.then((x) => (x.version as string) ?? "0.0.0")
		.catch(() => "0.0.0");

export const fetchLatestVersion = async () =>
	await fetch("https://registry.npmjs.org/@chneau/x/latest")
		.then((x) => x.json())
		.then((x) => x.version as string)
		.catch(() => "0.0.0");

export const envSubst = (str: string) =>
	str.replace(/\${(.*?)}/g, (_, key) => Bun.env[key] ?? "");
