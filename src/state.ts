import { createRequire } from "node:module";
import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import chalk from "chalk";
import { createEditorState } from "./adapters/editor-state-adapter";
import { loadV3ClassMetadata } from "./adapters/v3-adapter";
import { loadV4DesignSystem } from "./adapters/v4-adapter";
import { DEFAULT_SEPARATOR } from "./constants";
import type { ResolvedTailwindConfig, TailwindConfig } from "./types";
import {
	findTailwindConfigPath,
	isCssConfigFile,
	loadTailwindConfig,
} from "./utils/config";

const require = createRequire(import.meta.url || __filename);

function getTailwindVersion(cwd: string) {
	try {
		const tailwindPackageJson = require.resolve("tailwindcss/package.json", {
			paths: [cwd],
		});
		const { readFileSync } = require("node:fs");
		const pkg = JSON.parse(readFileSync(tailwindPackageJson, "utf-8")) as {
			version?: string;
		};
		return pkg.version;
	} catch {
		return undefined;
	}
}

function isV4Config(version: string | undefined) {
	return version?.startsWith("4.") ?? false;
}

function resolveTailwindPath(cwd: string, configDir?: string) {
	const paths = configDir ? [configDir, cwd] : [cwd];
	try {
		return require.resolve("tailwindcss", { paths });
	} catch {
		throw new Error(
			`Could not find tailwindcss module in ${paths.join(" or ")}.\n` +
				"Install it with: npm install -D tailwindcss",
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
		throw new Error(
			"Could not find Tailwind config file. Expected one of:\n" +
				"  • Tailwind v4 (CSS): app.css, index.css, tailwind.css in project root or src/\n" +
				"  • Tailwind v3 (JS): tailwind.config.js, tailwind.config.ts\n" +
				"Run 'npx tailwindcss init' to create a config file.",
		);
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
		console.log(chalk.cyan.bold("→ Tailwind Configuration"));
		console.log(chalk.dim(`  Version: ${version || "unknown"}`));
		console.log(
			chalk.dim(`  Config type: ${isCssConfig ? "CSS (v4)" : "JavaScript"}`),
		);
		console.log(chalk.dim(`  Config path: ${resolvedConfigPath}`));
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
