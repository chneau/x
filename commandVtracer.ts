import { existsSync } from "node:fs";
import { extname } from "node:path";
import type { Options } from "@visioncortex/vtracer";
import { convertFile } from "@visioncortex/vtracer";

type VtracerOptions = Partial<Options> & {
	verbose?: boolean;
};

const SVG_EXT = ".svg";

/** Ensure the output path ends with ".svg". */
const ensureSvg = (output: string) =>
	extname(output).toLowerCase() === SVG_EXT ? output : `${output}${SVG_EXT}`;

export const commandVtracer = async (
	input: string,
	output: string | undefined,
	options: VtracerOptions = {},
) => {
	const {
		verbose,
		preset,
		clustering,
		hierarchical,
		mode,
		filterSpeckle,
		colorPrecision,
		layerDifference,
		cornerThreshold,
		lengthThreshold,
		maxIterations,
		spliceThreshold,
		simplify,
		pathPrecision,
		palette,
		maxColors,
		optimize,
		binaryThreshold,
		adaptive,
		adaptiveWindow,
		adaptiveT,
		watershedDetail,
	} = options;

	if (input.length === 0) {
		throw new Error("Input path is required");
	}
	if (!existsSync(input)) {
		throw new Error(`Input file not found: ${input}`);
	}

	const out = ensureSvg(output ?? `${input}${SVG_EXT}`);
	const convertOptions: Options = {
		preset,
		clustering,
		hierarchical,
		mode,
		filterSpeckle,
		colorPrecision,
		layerDifference,
		cornerThreshold,
		lengthThreshold,
		maxIterations,
		spliceThreshold,
		simplify,
		pathPrecision,
		palette,
		maxColors,
		optimize,
		binaryThreshold,
		adaptive,
		adaptiveWindow,
		adaptiveT,
		watershedDetail,
	};

	for (const key of Object.keys(convertOptions) as (keyof Options)[]) {
		if (convertOptions[key] === undefined) {
			delete convertOptions[key];
		}
	}

	if (verbose) {
		console.log(`Converting ${input} → ${out}`);
		if (Object.keys(convertOptions).length > 0) {
			console.log(`Options: ${JSON.stringify(convertOptions)}`);
		} else {
			console.log("Options: (defaults)");
		}
	}

	await convertFile(input, out, convertOptions);
	console.log(`✅ Wrote ${out}`);
};
