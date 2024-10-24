import { $ } from "bun";
import { canSudo, commandExists, isRoot } from "./helpers";

const updateDotfiles = async () => {
	const initScript = await fetch(
		"https://raw.githubusercontent.com/chneau/dotfiles/master/bootstrap.sh",
	).then((x) => x.text());
	await $`echo ${initScript} | sh`.nothrow();
};

const updateBun = async () => {
	const bunPkgs = [
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
	await $`bun upgrade`.nothrow();
	await $`bun install --force --global ${{ raw: bunPkgs.join(" ") }}`.nothrow();
	await $`bun update --latest --force --global`.nothrow();
};

const updateApt = async () => {
	const essentialPkgs = ["git", "curl", "wget", "unzip", "zsh", "bash"];
	await $`sudo apt install -y ${{ raw: essentialPkgs.join(" ") }}`.nothrow();
	await $`sudo apt update -y`.nothrow();
	await $`sudo apt upgrade -y`.nothrow();
	await $`sudo apt autoremove -y`.nothrow();
	await $`sudo apt autoclean -y`.nothrow();
};

const updateBrew = async () => {
	if (!(await commandExists("brew"))) {
		await $`CI=1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.nothrow();
	}
	const essentialPkgs = [
		"bpytop",
		"dive",
		"dldash/core/docker-color-output",
		"docker-compose",
		"go",
		"helm",
		"hyperfine",
		"kubecolor",
		"kubectx",
		"kubernetes-cli",
		"lazygit",
		"node",
		"pipx",
		"zsh",
	];
	const brew =
		(await $`which brew`.text().catch(() => "")).trim() ||
		"/home/linuxbrew/.linuxbrew/bin/brew";
	await $`${brew} install ${{ raw: essentialPkgs.join(" ") }}`.nothrow();
	await $`${brew} update`.nothrow();
	await $`${brew} upgrade`.nothrow();
	await $`${brew} cleanup`.nothrow();
};

export const commandSystem = async () => {
	if (await isRoot()) throw new Error("You cannot run this command as root");
	if (!(await canSudo())) throw new Error("You cannot sudo");
	await updateDotfiles();
	await updateApt();
	await updateBun();
	await updateBrew();
	console.log("System updated");
};
