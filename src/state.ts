import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import { createEditorState } from "./adapters/editor-state-adapter";
import { loadV3ClassMetadata } from "./adapters/v3-adapter";
import { loadV4DesignSystem } from "./adapters/v4-adapter";
import {
	DEFAULT_SEPARATOR,
	V3_CONFIG_PATHS,
	V4_CSS_FOLDERS,
	V4_CSS_NAMES,
} from "./constants";
import type { ResolvedTailwindConfig, TailwindConfig } from "./types";

const require = createRequire(import.meta.url || __filename);

function fileExists(filePath: string): boolean {
	try {
		return fs.existsSync(filePath);
	} catch {
		return false;
	}
}

function readFileSync(filePath: string): string {
	if (!filePath || typeof filePath !== "string") {
		throw new TypeError("File path must be a non-empty string");
	}
	return fs.readFileSync(filePath, "utf-8");
}

function getTailwindVersion(cwd: string): string | undefined {
	try {
		const tailwindPackageJson = require.resolve("tailwindcss/package.json", {
			paths: [cwd],
		});
		const pkg = JSON.parse(fs.readFileSync(tailwindPackageJson, "utf-8")) as {
			version?: string;
		};
		return pkg.version;
	} catch {
		return undefined;
	}
}

function isV4Config(version: string | undefined): boolean {
	return version?.startsWith("4.") ?? false;
}

function isCssConfigFile(filePath: string): boolean {
	return filePath.endsWith(".css");
}

async function loadTailwindConfig(configPath: string): Promise<TailwindConfig> {
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
		throw new Error(
			`Failed to load config from ${configPath}: ${errorMessage}`,
		);
	}
}

async function findTailwindConfigPath(
	cwd: string,
	configPath?: string,
): Promise<string | null> {
	if (configPath) {
		const resolved = path.isAbsolute(configPath)
			? configPath
			: path.resolve(cwd, configPath);
		return fileExists(resolved) ? resolved : null;
	}

	for (const p of V3_CONFIG_PATHS) {
		const fullPath = path.join(cwd, p);
		if (fileExists(fullPath)) {
			return fullPath;
		}
	}

	const v4Paths = V4_CSS_FOLDERS.flatMap((folder) =>
		V4_CSS_NAMES.map((name) => path.join(folder, name)),
	);

	for (const p of v4Paths) {
		const fullPath = path.join(cwd, p);
		if (fileExists(fullPath)) {
			try {
				const content = readFileSync(fullPath);
				if (
					content.includes('@import "tailwindcss"') ||
					content.includes("@import 'tailwindcss'")
				) {
					return fullPath;
				}
			} catch {}
		}
	}

	return null;
}

function resolveTailwindPath(cwd: string, configDir?: string): string {
	const paths = configDir ? [configDir, cwd] : [cwd];
	try {
		return require.resolve("tailwindcss", { paths });
	} catch {
		throw new Error(
			`Could not resolve tailwindcss module from ${paths.join(" or ")}`,
		);
	}
}

export async function createState(
	cwd: string,
	configPath?: string,
	verbose = false,
): Promise<State> {
	const resolvedConfigPath = await findTailwindConfigPath(cwd, configPath);

	if (!resolvedConfigPath) {
		throw new Error("Could not find tailwind config file (JS/TS or CSS)");
	}

	const isCssConfig = isCssConfigFile(resolvedConfigPath);
	const configDir = path.dirname(resolvedConfigPath);
	const tailwindPath = resolveTailwindPath(cwd, configDir);

	const tailwindcss = require(tailwindPath) as {
		resolveConfig?: (config: unknown) => unknown;
	};

	const version = getTailwindVersion(cwd);
	const isV4 = isV4Config(version);

	if (verbose) {
		console.log(`  Tailwind version: ${version || "unknown"}`);
		console.log(`  Config type: ${isCssConfig ? "CSS (v4)" : "JavaScript"}`);
		console.log(`  Config path: ${resolvedConfigPath}`);
	}

	let config: TailwindConfig = {};
	let resolvedConfig: ResolvedTailwindConfig = { separator: ":" };

	if (!isCssConfig) {
		config = await loadTailwindConfig(resolvedConfigPath);
		resolvedConfig = {
			...config,
			separator: config.separator ?? DEFAULT_SEPARATOR,
		};
		if (tailwindcss.resolveConfig) {
			resolvedConfig = tailwindcss.resolveConfig(
				config,
			) as ResolvedTailwindConfig;
		}
	}

	const state: State = {
		enabled: true,
		configPath: resolvedConfigPath,
		config: resolvedConfig,
		version,
		v4: isV4 || undefined,
		separator: resolvedConfig.separator || DEFAULT_SEPARATOR,
		screens: [],
		variants: [],
		classNames: undefined,
		classList: undefined,
		modules: undefined,
		blocklist: [],
		editor: createEditorState(cwd),
		features: ["diagnostics"] as unknown as State["features"],
	};

	if (isV4 || isCssConfig) {
		await loadV4DesignSystem(state, cwd, resolvedConfigPath, verbose);
	} else {
		await loadV3ClassMetadata(state, cwd, verbose);
	}

	return state;
}
