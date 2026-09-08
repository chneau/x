import { $ } from "bun";
import { c } from "./helpers";

/** Current kubectl context name ("unknown" when unavailable). */
export const kubectlContext = async (): Promise<string> =>
	(
		await $`kubectl config current-context`.text().catch(() => "unknown")
	).trim();

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
