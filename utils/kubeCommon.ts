import { $ } from "bun";
import { c } from "./helpers";

/** Current kubectl context name ("unknown" when unavailable). */
export const kubectlContext = async (): Promise<string> =>
	(
		await $`kubectl config current-context`.text().catch(() => "unknown")
	).trim();

/** All available kubectl context names. */
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

/** Print the styled `[Context: ...]` banner shared by kubernetes commands. */
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
