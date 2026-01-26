import { createRequire } from "node:module";
import * as path from "node:path";
import { V3_CONFIG_PATHS, V4_CSS_FOLDERS, V4_CSS_NAMES } from "../constants";
import type { TailwindConfig } from "../types";
import { fileExists, readFileSync } from "./fs";

const require = createRequire(import.meta.url || __filename);

export function isCssConfigFile(filePath: string): boolean {
	return filePath.endsWith(".css");
}

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
				if (
					content.includes('@import "tailwindcss"') ||
					content.includes("@import 'tailwindcss'")
				) {
					return fullPath;
				}
			} catch {
				// File exists but can't be read (permission denied, etc.) - skip it
				// This is expected behavior when scanning directories
			}
		}
	}

	return null;
}
