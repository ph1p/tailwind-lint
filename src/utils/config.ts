import { createRequire } from "node:module";
import * as path from "node:path";
import glob from "fast-glob";
import {
	DEFAULT_IGNORE_PATTERNS,
	TAILWIND_V4_IMPORT_REGEX,
	V3_CONFIG_PATHS,
	V4_CSS_FOLDERS,
	V4_CSS_NAMES,
} from "../constants";
import type { TailwindConfig } from "../types";
import { fileExists, readFileSync } from "./fs";

const require = createRequire(import.meta.url || __filename);
const CONFIG_DISCOVERY_MAX_DEPTH = 8;

export const isCssConfigFile = (filePath: string) => filePath.endsWith(".css");

export async function loadTailwindConfig(
	configPath: string,
): Promise<TailwindConfig> {
	if (isCssConfigFile(configPath)) {
		return {};
	}

	if (!path.isAbsolute(configPath)) {
		throw new Error(
			`Config path must be absolute for security reasons: ${configPath}`,
		);
	}

	try {
		delete require.cache[configPath];

		const configModule = require(configPath) as
			| TailwindConfig
			| { default: TailwindConfig };
		const config = (
			"default" in configModule ? configModule.default : configModule
		) as TailwindConfig;

		if (typeof config !== "object" || config === null) {
			throw new Error("Config must be an object");
		}

		return config;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		if (errorMessage.includes("Cannot find module")) {
			throw new Error(
				`Failed to load config from ${configPath}.\n` +
					"The config file may have missing dependencies. Check that all imports are installed.",
			);
		}

		if (
			errorMessage.includes("SyntaxError") ||
			errorMessage.includes("Unexpected token")
		) {
			throw new Error(
				`Failed to parse config from ${configPath}.\n` +
					"The config file has syntax errors. Check your JavaScript/TypeScript syntax.",
			);
		}

		throw new Error(
			`Failed to load config from ${configPath}: ${errorMessage}`,
		);
	}
}

export async function findTailwindConfigPath(
	cwd: string,
	configPath?: string,
): Promise<string | null> {
	if (configPath) {
		const resolved = path.isAbsolute(configPath)
			? configPath
			: path.resolve(cwd, configPath);
		return fileExists(resolved) ? resolved : null;
	}

	// Search for v3 JavaScript config files
	for (const p of V3_CONFIG_PATHS) {
		const fullPath = path.join(cwd, p);
		if (fileExists(fullPath)) {
			return fullPath;
		}
	}

	// Fallback: search for v3 config files recursively
	const v3Recursive = await glob(
		V3_CONFIG_PATHS.map((p) => `**/${p}`),
		{
			cwd,
			absolute: true,
			ignore: DEFAULT_IGNORE_PATTERNS,
			deep: CONFIG_DISCOVERY_MAX_DEPTH,
		},
	);
	if (v3Recursive.length > 0) {
		return sortByPathDepth(v3Recursive)[0];
	}

	// Search for v4 CSS config files
	const v4Paths = V4_CSS_FOLDERS.flatMap((folder) =>
		V4_CSS_NAMES.map((name) => path.join(folder, name)),
	);

	for (const p of v4Paths) {
		const fullPath = path.join(cwd, p);
		if (fileExists(fullPath)) {
			try {
				const content = readFileSync(fullPath);
				// Verify it's a valid Tailwind v4 CSS config
				if (TAILWIND_V4_IMPORT_REGEX.test(content)) {
					return fullPath;
				}
			} catch {
				// File exists but can't be read (permission denied, etc.) - skip it
				// This is expected behavior when scanning directories
			}
		}
	}

	// Fallback: search recursively for CSS files that import tailwindcss
	const cssCandidates = await glob("**/*.css", {
		cwd,
		absolute: true,
		ignore: DEFAULT_IGNORE_PATTERNS,
		deep: CONFIG_DISCOVERY_MAX_DEPTH,
	});

	const v4Matches: string[] = [];
	for (const candidate of cssCandidates) {
		try {
			const content = readFileSync(candidate);
			if (TAILWIND_V4_IMPORT_REGEX.test(content)) {
				v4Matches.push(candidate);
			}
		} catch {
			// Skip unreadable files during scan
		}
	}

	if (v4Matches.length > 0) {
		return sortCssCandidates(cwd, v4Matches)[0];
	}

	return null;
}

function sortByPathDepth(paths: string[]) {
	return [...paths].sort((a, b) => {
		const depthA = splitDepth(a);
		const depthB = splitDepth(b);
		if (depthA !== depthB) return depthA - depthB;
		return a.localeCompare(b);
	});
}

function sortCssCandidates(cwd: string, paths: string[]) {
	return [...paths].sort((a, b) => {
		const scoreA = cssCandidateScore(cwd, a);
		const scoreB = cssCandidateScore(cwd, b);
		if (scoreA !== scoreB) return scoreA - scoreB;
		return a.localeCompare(b);
	});
}

function cssCandidateScore(cwd: string, candidate: string) {
	const relative = path.relative(cwd, candidate);
	const normalized = relative.split(path.sep).join("/");
	const base = path.basename(candidate);
	const depth = splitDepth(normalized);

	const nameScore = V4_CSS_NAMES.includes(base) ? 0 : 20;
	const folderScore = isPreferredCssFolder(normalized) ? 0 : 10;

	return depth * 100 + nameScore + folderScore;
}

function isPreferredCssFolder(relativePath: string) {
	const folder = path.dirname(relativePath).replace(/\\/g, "/");
	const withSlash = folder === "." ? "./" : `./${folder}/`;
	return V4_CSS_FOLDERS.includes(withSlash);
}

function splitDepth(value: string) {
	return value.split(/[\\/]/).filter(Boolean).length;
}
