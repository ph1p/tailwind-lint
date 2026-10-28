import { createRequire } from "node:module";
import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import ansis from "ansis";
import { createEditorState } from "./adapters/editor-state-adapter";
import { loadV3ClassMetadata } from "./adapters/v3-adapter";
import { loadV4DesignSystem } from "./adapters/v4-adapter";
import { DEFAULT_SEPARATOR } from "./constants";
import type { ResolvedTailwindConfig, TailwindConfig } from "./types";
import { type TailwindConfigTarget, loadTailwindConfig } from "./utils/config";
import type { RootFontSize } from "./utils/root-font-size";

const require = createRequire(import.meta.url || __filename);

function getTailwindVersion(paths: string[]) {
	try {
		const tailwindPackageJson = require.resolve("tailwindcss/package.json", {
			paths,
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

function resolveTailwindPath(paths: string[]) {
	try {
		return require.resolve("tailwindcss", { paths });
	} catch {
		throw new Error(
			`Could not find tailwindcss module in ${paths.join(" or ")}.\n` +
				"Install it with: npm install -D tailwindcss",
		);
	}
}

function loadResolveConfig(paths: string[]) {
	try {
		const module = require(
			require.resolve("tailwindcss/resolveConfig", { paths }),
		) as
			| ((config: unknown) => unknown)
			| { default: (config: unknown) => unknown };
		return typeof module === "function" ? module : module.default;
	} catch {
		return undefined;
	}
}

const CONFIG_TYPE_LABELS = {
	css: "CSS (v4)",
	vite: "Vite (v4)",
	js: "JavaScript",
} as const;

export async function createState(
	cwd: string,
	target: TailwindConfigTarget,
	verbose = false,
	rootFontSize?: RootFontSize,
): Promise<State> {
	const isCssConfig = target.kind !== "js";
	// Config's package first: monorepo packages may pin different Tailwind versions
	const resolvePaths = [path.dirname(target.path), cwd];
	resolveTailwindPath(resolvePaths);

	const version = getTailwindVersion(resolvePaths);
	const isV4 = isV4Config(version);

	if (verbose) {
		console.log(ansis.cyan.bold("→ Tailwind Configuration"));
		console.log(ansis.dim(`  Version: ${version || "unknown"}`));
		console.log(ansis.dim(`  Config type: ${CONFIG_TYPE_LABELS[target.kind]}`));
		console.log(ansis.dim(`  Config path: ${target.path}`));
		if (rootFontSize) {
			console.log(
				ansis.dim(
					`  Root font size: ${rootFontSize.size}px (${rootFontSize.source})`,
				),
			);
		}
	}

	let config: TailwindConfig = {};
	let resolvedConfig: ResolvedTailwindConfig = { separator: ":" };

	if (!isCssConfig) {
		config = await loadTailwindConfig(target.path);
		resolvedConfig = {
			...config,
			separator: config.separator ?? DEFAULT_SEPARATOR,
		};
		const resolveConfig = loadResolveConfig(resolvePaths);
		if (resolveConfig) {
			resolvedConfig = resolveConfig(config) as ResolvedTailwindConfig;
		}
	}

	const state: State = {
		enabled: true,
		configPath: target.path,
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
		editor: createEditorState(cwd, rootFontSize?.size),
		features: ["diagnostics"] as unknown as State["features"],
	};

	if (isV4 || isCssConfig) {
		await loadV4DesignSystem(state, resolvePaths, target, verbose);
	} else {
		await loadV3ClassMetadata(state, resolvePaths, verbose);
	}

	return state;
}
