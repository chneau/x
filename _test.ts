import { readdir } from "node:fs/promises";

const getDirectories = async (path = ".") =>
	(await readdir(path, { withFileTypes: true }))
		.filter((x) => x.isDirectory())
		.filter((x) => !x.name.startsWith("."))
		.filter((x) => !x.name.includes("node_modules"))
		.map((x) => `${path}/${x.name}`);

const getDirectoriesDeep = async (path = ".", level = 0) => {
	if (level === 0) return [path];
	const directories = await getDirectories(path);
	let _level = level - 1;
	while (_level > 0) {
		for (const directory of directories) {
			const p = await getDirectories(directory);
			directories.push(...p);
		}
		_level--;
	}
	directories.push(path);
	return directories;
};

const x = await getDirectoriesDeep("..", 2);
console.log(x);

// for (let i = 0; i < 7; i++) {
// 	const x = await getDirectoriesDeep("..", i);
// 	console.log(x.length);
// }
