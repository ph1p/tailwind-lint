import * as path from "node:path";
import ansis from "ansis";
import { resolveConcurrency } from "./concurrency";
import { processWithWorkers, type WorkerTask } from "./worker-pool";
import { glob } from "tinyglobby";
import {
	DEFAULT_FILE_PATTERN,
	DEFAULT_IGNORE_PATTERNS,
	MAX_FILE_SIZE_BYTES,
	SYNTHETIC_VITE_CSS_CONFIG_CONTENT,
} from "./constants";
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

const SOURCE_FILE_PATTERN = "**/*.{js,jsx,ts,tsx,html,vue,svelte,astro,mdx}";
const GLOB_PATTERN_REGEX = /[*?[\]{}]/;
const MAX_LISTED_PACKAGES = 10;

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

function extractSourcePatterns(cssContent: string) {
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

function extractImportSourceDirectives(cssContent: string) {
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

export { extractImportSourceDirectives, extractSourcePatterns };
export type { LintFileResult, LintOptions, LintResult };

export async function lint({
	cwd,
	patterns,
	configPath,
	autoDiscover,
	fix = false,
	verbose = false,
	concurrency = 1,
	onProgress,
}: LintOptions): Promise<LintResult> {
	const workerCount = resolveConcurrency(concurrency);
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

		for (const discoveredFile of files) {
			// Globs and explicit config paths may use different separators on Windows.
			const file = path.resolve(discoveredFile);
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

	const tasks: WorkerTask[] = targets.flatMap((target) => {
		const files = filesByTarget.get(target);
		return files
			? [{ target, files: files.sort((a, b) => a.localeCompare(b)) }]
			: [];
	});
	const results: LintFileResult[] = [];
	if (workerCount > 1 && totalFiles > 1) {
		results.push(
			...(await processWithWorkers(
				{ cwd, fix, verbose, onProgress },
				tasks,
				workerCount,
			)),
		);
	} else {
		const { initializeState, processFiles } = await import("./file-processor");
		let processedCount = 0;
		for (const { target, files } of tasks) {
			const offset = processedCount;
			processedCount += files.length;
			const state = await initializeState(cwd, target, verbose);
			results.push(
				...(await processFiles(
					state,
					cwd,
					files,
					fix,
					onProgress &&
						((current, _total, file) =>
							onProgress(offset + current, totalFiles, file)),
				)),
			);
		}
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
