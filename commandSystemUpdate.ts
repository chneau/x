import { $ } from "bun";

const commandExists = async (cmd: string) =>
	(await $`which ${cmd}`.text().catch(() => "")).trim() !== "";

const updateDotfiles = async () => {
	const initScript = await fetch(
		"https://raw.githubusercontent.com/chneau/dotfiles/master/bootstrap.sh",
	).then((x) => x.text());
	await $`echo ${initScript} | sh`;
};

const updateBun = async () => {
	const bunPkgs = [
		"npm",
		"@biomejs/biome",
		"http-server",
		"live-server",
		"fkill-cli",
		"ungit",
		"npm-check",
		"tsx",
		"npm-check-updates",
		"nodemon",
		"prettier",
		"typesync",
		"depcheck",
		"concurrently",
		"ts-unused-exports",
	];
	await $`bun upgrade`;
	await $`bun install --force --global ${{ raw: bunPkgs.join(" ") }}`;
	await $`bun update --latest --force --global`;
};

const updateApt = async () => {
	const essentialPkgs = ["git", "curl", "wget", "unzip", "zsh", "git", "bash"];
	await $`sudo apt install -y ${{ raw: essentialPkgs.join(" ") }}`;
	await $`sudo apt update -y`;
	await $`sudo apt upgrade -y`;
	await $`sudo apt autoremove -y`;
	await $`sudo apt autoclean -y`;
};

const updateBrew = async () => {
	if (!(await commandExists("brew")))
		await $`CI=1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`;
	await $`brew update`;
	await $`brew upgrade`;
	await $`brew cleanup`;
};

export const commandSystemUpdate = async () => {
	await updateApt();
	await updateBrew();
	await updateDotfiles();
	await updateBun();
	console.log("System updated");
};
