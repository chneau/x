import { c } from "./helpers";
import { $ } from "./verboseShell";

export const kubectlContext = async (): Promise<string> =>
	(
		await $`kubectl config current-context`.text().catch(() => "unknown")
	).trim();

export const kubectlContexts = async (): Promise<string[]> => {
	try {
		const raw = await $`kubectl config get-contexts -o name`.text();
		return raw
			.split("\n")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	} catch {
		return [];
	}
};

export const printContextBanner = (
	title: string,
	context: string,
	note = "",
) => {
	console.log(
		`${c.bold}${title} [Context: ${c.cyan}${context}${c.reset}${
			note ? ` ${c.dim}${note}${c.reset}` : ""
		}]${c.reset}\n`,
	);
};
