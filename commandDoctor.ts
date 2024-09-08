import { canSudo, isRoot } from "./helpers";
import { pkgs } from "./pkgs";

export const commandDoctor = async () => {
	if (await isRoot()) {
		console.log("❌ You are root");
	} else {
		console.log("✅ You are not root");
	}
	if (await canSudo()) {
		console.log("✅ You can sudo");
	} else {
		console.log("❌ You cannot sudo");
	}
	const result = await Promise.all(
		pkgs.map(async (pkg) => ({ name: pkg.name, exists: await pkg.check() })),
	).then((x) => x.filter((y) => !y.exists));
	if (result.length === 0) {
		console.log("✅ All packages are installed");
	} else {
		console.log("❌ Some packages are not installed");
		console.table(result);
	}
};
