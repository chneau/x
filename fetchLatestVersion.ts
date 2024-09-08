export const fetchLatestVersion = async () =>
	await fetch("https://registry.npmjs.org/@chneau/x/latest")
		.then((x) => x.json().then((x) => x.version as string))
		.catch(() => "UNKNOWN");
