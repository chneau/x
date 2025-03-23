export const envSubst = (str: string) => {
	const env = Bun.env;
	return str.replace(/\${(.*?)}/g, (_, key) => env[key] || "");
};
