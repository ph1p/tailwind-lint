import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import { doValidate } from "@tailwindcss/language-service";
import ansis from "ansis";
import { glob } from "tinyglobby";
import { TextDocument } from "vscode-languageserver-textdocument";
import { applyCodeActions } from "./code-actions";
import {
	CONCURRENT_FILES,
	DEFAULT_FILE_PATTERN,
	DEFAULT_IGNORE_PATTERNS,
	MAX_FILE_SIZE_BYTES,
	SYNTHETIC_VITE_CSS_CONFIG_CONTENT,
	getLanguageId,
} from "./constants";
import { createState } from "./state";
import type {
	LintFileResult,
	LintOptions,
	LintResult,
	TailwindConfig,
} from "./types";
import {
	type TailwindConfigTarget,
	findTailwindConfigs,
	isInsideDir,
	loadTailwindConfig,
	nestedRootIgnores,
	toConfigTarget,
} from "./utils/config";
import {
	fileExists,
	getFileSize,
	readFileSync,
	readGitignorePatterns,
} from "./utils/fs";
import { type RootFontSize, detectRootFontSize } from "./utils/root-font-size";
import { loadWorkspaceTailwindSettings } from "./utils/settings";

const SOURCE_FILE_PATTERN = "**/*.{js,jsx,ts,tsx,html,vue,svelte,astro,mdx}";
const GLOB_PATTERN_REGEX = /[*?[\]{}]/;
const MAX_LISTED_PACKAGES = 10;

async function validateDocument(
	state: State,
	filePath: string,
	content: string,
) {
	try {
		if (!state) {
			throw new Error("State is not initialized");
		}

		if (state.v4 && !state.designSystem) {
			throw new Error(
				"Design system not initialized for Tailwind v4. This might indicate a configuration issue.",
			);
		}

		if (!state.v4 && !state.modules?.tailwindcss) {
			throw new Error(
				"Tailwind modules not initialized for Tailwind v3. This might indicate a configuration issue.",
			);
		}

		const languageId = getLanguageId(filePath);
		const uri = `file://${filePath}`;
		const document = TextDocument.create(uri, languageId, 1, content);

		return await doValidate(state, document);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		if (message.includes("Cannot read") || message.includes("undefined")) {
			if (process.env.DEBUG) {
				console.error(`Debug: Language service error for ${filePath}:`, error);
			}
			console.warn(
				`Warning: Language service crashed while validating ${filePath}. Skipping this file.`,
			);
			return [];
		}

		throw new Error(`Failed to validate document ${filePath}: ${message}`);
	}
}

async function expandPatterns(
	cwd: string,
	patterns: string[],
	extraIgnore: string[] = [],
) {
	return glob(patterns, {
		cwd,
		absolute: true,
		ignore: [...DEFAULT_IGNORE_PATTERNS, ...extraIgnore],
	});
}

async function discoverFilesFromConfig(
	target: TailwindConfigTarget,
	configRoots: string[],
) {
	if (target.kind === "js") {
		const config = await loadTailwindConfig(target.path);

		if (!config || !config.content) {
			throw new Error(
				"Tailwind config is missing the 'content' property.\n" +
					"Add a content array to specify which files to scan:\n" +
					"  content: ['./src/**/*.{js,jsx,ts,tsx}']",
			);
		}

		const patterns = extractContentPatterns(config);

		if (patterns.length === 0) {
			throw new Error(
				"No content patterns found in Tailwind config.\n" +
					"Ensure your config has a content array with file patterns.",
			);
		}

		const isRelative =
			!Array.isArray(config.content) && config.content.relative === true;
		return expandPatterns(
			isRelative ? path.dirname(target.path) : target.root,
			patterns,
		);
	}

	const { root } = target;
	const configDir = path.dirname(target.path);
	const cssContent =
		target.kind === "vite"
			? SYNTHETIC_VITE_CSS_CONFIG_CONTENT
			: readFileSync(target.path);
	const { include, exclude } = extractSourcePatterns(cssContent);
	const importSource = extractImportSourceDirectives(cssContent);

	const resolveFromConfig = (pattern: string) =>
		path.relative(root, path.resolve(configDir, pattern));

	const resolvedExclude = exclude.map(resolveFromConfig);
	// Packages with their own config are linted by that config instead
	const extraIgnore = [
		...resolvedExclude,
		...readGitignorePatterns(root),
		...nestedRootIgnores(root, configRoots),
	];

	const explicitSourcePatterns = include.map((source) =>
		resolveFromConfig(normalizeSourcePattern(source)),
	);

	let autoPatterns: string[] = [];
	if (!importSource.disableAutoSource) {
		autoPatterns =
			importSource.roots.length > 0
				? importSource.roots.map((sourceRoot) =>
						resolveFromConfig(normalizeSourcePattern(sourceRoot)),
					)
				: [DEFAULT_FILE_PATTERN];
	}

	const [autoFiles, explicitFiles] = await Promise.all([
		autoPatterns.length > 0
			? expandPatterns(root, autoPatterns, extraIgnore)
			: [],
		explicitSourcePatterns.length > 0
			? expandPatterns(root, explicitSourcePatterns, resolvedExclude)
			: [],
	]);

	const configFile = target.kind === "css" ? [target.path] : [];
	return [...new Set([...configFile, ...autoFiles, ...explicitFiles])];
}

function normalizeSourcePattern(pattern: string) {
	if (GLOB_PATTERN_REGEX.test(pattern) || path.extname(pattern)) {
		return pattern;
	}

	return path.join(pattern, SOURCE_FILE_PATTERN);
}

function extractContentPatterns(config: TailwindConfig) {
	if (!config.content) return [];

	const content = Array.isArray(config.content)
		? config.content
		: config.content.files || [];

	return content.filter((p): p is string => typeof p === "string");
}

function extractSourcePatterns(cssContent: string): {
	include: string[];
	exclude: string[];
} {
	const include: string[] = [];
	const exclude: string[] = [];
	const sourceRegex = /@source\s+(not\s+)?(?:inline\(|["']([^"']+)["'])/g;

	for (const match of cssContent.matchAll(sourceRegex)) {
		const isNot = !!match[1];
		const filePath = match[2];

		if (!filePath) continue;

		if (isNot) {
			exclude.push(filePath);
		} else {
			include.push(filePath);
		}
	}

	return { include, exclude };
}

function extractImportSourceDirectives(cssContent: string): {
	roots: string[];
	disableAutoSource: boolean;
} {
	const roots: string[] = [];
	let disableAutoSource = false;
	const importSourceRegex =
		/@import\s+["']tailwindcss(?:[^;]*?)\ssource\(\s*(none|["'][^"']+["'])\s*\)/g;

	for (const match of cssContent.matchAll(importSourceRegex)) {
		const raw = match[1];
		if (!raw) continue;

		if (raw === "none") {
			disableAutoSource = true;
			continue;
		}

		const sourceRoot = raw.slice(1, -1).trim();
		if (sourceRoot.length > 0) {
			roots.push(sourceRoot);
		}
	}

	return {
		roots: [...new Set(roots)],
		disableAutoSource,
	};
}

async function processFiles(
	state: State,
	cwd: string,
	files: string[],
	fix: boolean,
	dryRun: boolean,
	onProgress?: (current: number, total: number, file: string) => void,
) {
	const results: (LintFileResult | null)[] = Array.from({
		length: files.length,
	});
	let next = 0;
	let started = 0;

	// A pool keeps CONCURRENT_FILES files in flight, so one slow file does
	// not stall a whole batch while its file I/O overlaps with validation.
	const worker = async () => {
		while (next < files.length) {
			const index = next++;
			const file = files[index];
			onProgress?.(++started, files.length, file);
			results[index] = await processFile(state, cwd, file, fix, dryRun);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(CONCURRENT_FILES, files.length) }, worker),
	);

	return results.filter((result): result is LintFileResult => result !== null);
}

async function readFileIfExists(filePath: string) {
	try {
		return await fs.readFile(filePath, "utf-8");
	} catch {
		return null;
	}
}

async function processFile(
	state: State,
	cwd: string,
	filePath: string,
	fix: boolean,
	dryRun: boolean,
): Promise<LintFileResult | null> {
	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(cwd, filePath);

	const content = await readFileIfExists(absolutePath);
	if (content === null) {
		return null;
	}

	let diagnostics: LintFileResult["diagnostics"] = await validateDocument(
		state,
		absolutePath,
		content,
	);

	let fixedCount = 0;
	let fixedContent: string | undefined;

	if (fix && diagnostics.length > 0) {
		const fixResult = await applyCodeActions(
			state,
			absolutePath,
			content,
			diagnostics,
		);

		if (fixResult.changed) {
			if (dryRun) {
				fixedContent = fixResult.content;
			} else {
				await fs.writeFile(absolutePath, fixResult.content, "utf-8");
			}
			fixedCount = fixResult.fixedCount;
			diagnostics = fixResult.diagnostics;
		}
	}

	return {
		path: path.relative(cwd, absolutePath),
		diagnostics,
		fixed: fixedCount > 0,
		fixedCount,
		...(fixedContent !== undefined && {
			originalContent: content,
			fixedContent,
		}),
	};
}

async function initializeState(
	cwd: string,
	target: TailwindConfigTarget,
	verbose = false,
	rootFontSize?: RootFontSize,
) {
	try {
		const state = await createState(cwd, target, verbose, rootFontSize);
		if (verbose) {
			console.log();
		}
		return state;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to initialize Tailwind state: ${message}`);
	}
}

export { extractImportSourceDirectives, extractSourcePatterns };
export type { LintFileResult, LintOptions, LintResult };

export async function lint({
	cwd,
	patterns,
	configPath,
	autoDiscover,
	fix = false,
	dryRun = false,
	verbose = false,
	rootFontSize,
	onProgress,
}: LintOptions): Promise<LintResult> {
	const settingsRootFontSize = loadWorkspaceTailwindSettings(cwd).rootFontSize;
	const configuredRootFontSize: RootFontSize | undefined =
		rootFontSize !== undefined
			? { size: rootFontSize, source: "--root-font-size" }
			: settingsRootFontSize !== undefined
				? { size: settingsRootFontSize, source: "editor settings" }
				: undefined;

	const targets = await resolveConfigTargets(cwd, configPath);
	if (verbose) {
		logTargets(cwd, targets);
	}

	const configRoots = targets.map((target) => target.root);
	const patternFiles = autoDiscover ? [] : await expandPatterns(cwd, patterns);
	const discoveredFilesByTarget = await Promise.all(
		targets.map((target) =>
			autoDiscover
				? discoverFilesFromConfig(target, configRoots)
				: patternFiles,
		),
	);

	const owners = new Map<string, TailwindConfigTarget>();
	for (const [index, target] of targets.entries()) {
		const files =
			target.kind === "css" && !autoDiscover
				? [target.path, ...discoveredFilesByTarget[index]]
				: discoveredFilesByTarget[index];

		for (const file of files) {
			const current = owners.get(file);
			if (
				!current ||
				ownershipScore(target, file) > ownershipScore(current, file)
			) {
				owners.set(file, target);
			}
		}
	}

	const skippedFiles: string[] = [];
	const filesByTarget = new Map<TailwindConfigTarget, string[]>();
	for (const [absolutePath, target] of owners) {
		const file = path.relative(cwd, absolutePath);
		if (getFileSize(absolutePath) > MAX_FILE_SIZE_BYTES) {
			skippedFiles.push(file);
			continue;
		}
		const files = filesByTarget.get(target) ?? [];
		files.push(file);
		filesByTarget.set(target, files);
	}

	const totalFiles = owners.size - skippedFiles.length;
	if (verbose) {
		console.log(
			ansis.cyan.bold(
				`→ Discovered ${totalFiles} file${totalFiles !== 1 ? "s" : ""} to lint`,
			),
		);
		console.log();
	}

	const results: LintFileResult[] = [];
	let processedCount = 0;
	for (const target of targets) {
		const files = filesByTarget.get(target);
		if (!files) continue;

		const offset = processedCount;
		processedCount += files.length;
		const state = await initializeState(
			cwd,
			target,
			verbose,
			configuredRootFontSize ??
				(await detectRootFontSize(cwd, target.path, files)),
		);
		const processed = await processFiles(
			state,
			cwd,
			files.sort((a, b) => a.localeCompare(b)),
			fix || dryRun,
			dryRun,
			onProgress &&
				((current, _total, file) =>
					onProgress(offset + current, totalFiles, file)),
		);
		results.push(...processed);
	}

	return {
		files: results
			.filter((result) => result.diagnostics.length > 0 || result.fixed)
			.sort((a, b) => a.path.localeCompare(b.path)),
		totalFilesProcessed: totalFiles,
		skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
	};
}

async function resolveConfigTargets(cwd: string, configPath?: string) {
	if (configPath) {
		const absolutePath = path.resolve(cwd, configPath);
		if (!fileExists(absolutePath)) {
			throw new Error(`Tailwind config file not found: ${absolutePath}`);
		}
		return [toConfigTarget(absolutePath)];
	}

	const { targets, packageRoots } = await findTailwindConfigs(cwd);
	if (targets.length === 0) {
		throw new Error(noConfigMessage(cwd, packageRoots));
	}
	return targets;
}

function noConfigMessage(cwd: string, packageRoots: string[]) {
	const packages = packageRoots
		.map((root) => path.relative(cwd, root))
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
	const shown = packages.slice(0, MAX_LISTED_PACKAGES);
	const more = packages.length - shown.length;
	const searched =
		packages.length > 0
			? ` or its packages:\n${shown.map((p) => `  • ${p}`).join("\n")}${more > 0 ? `\n  …and ${more} more` : ""}`
			: "";

	return (
		`Could not find a Tailwind config in ${cwd}${searched}\n` +
		"Expected one of:\n" +
		'  • Tailwind v4 (CSS): a CSS file with @import "tailwindcss", e.g. app.css or src/index.css\n' +
		"  • Tailwind v4 (Vite): vite.config.* with @tailwindcss/vite\n" +
		"  • Tailwind v3 (JS): tailwind.config.js, tailwind.config.ts\n" +
		"Use --config to specify the path."
	);
}

function logTargets(cwd: string, targets: TailwindConfigTarget[]) {
	const display = (p: string) => path.relative(cwd, p) || ".";
	console.log(ansis.cyan.bold("→ Tailwind configs"));
	for (const target of targets) {
		console.log(
			ansis.dim(`  ${display(target.root)} → ${display(target.path)}`),
		);
	}
	console.log();
}

function ownershipScore(target: TailwindConfigTarget, absolutePath: string) {
	return isInsideDir(target.root, absolutePath) ? target.root.length : -1;
}
