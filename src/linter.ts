import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import { doValidate } from "@tailwindcss/language-service";
import chalk from "chalk";
import glob from "fast-glob";
import { TextDocument } from "vscode-languageserver-textdocument";
import { applyCodeActions } from "./code-actions";
import {
	CONCURRENT_FILES,
	DEFAULT_FILE_PATTERN,
	DEFAULT_IGNORE_PATTERNS,
	getLanguageId,
} from "./constants";
import { createState } from "./state";
import type {
	LintFileResult,
	LintOptions,
	LintResult,
	SerializedDiagnostic,
	TailwindConfig,
} from "./types";
import {
	findTailwindConfigPath,
	isCssConfigFile,
	loadTailwindConfig,
} from "./utils/config";
import { fileExists, readFileSync, writeFileSync } from "./utils/fs";

function serializeDiagnostics(
	diagnostics: import("vscode-languageserver").Diagnostic[],
): SerializedDiagnostic[] {
	return diagnostics.map((diagnostic) => ({
		range: {
			start: {
				line: diagnostic.range.start.line,
				character: diagnostic.range.start.character,
			},
			end: {
				line: diagnostic.range.end.line,
				character: diagnostic.range.end.character,
			},
		},
		severity: diagnostic.severity || 2,
		message: diagnostic.message,
		code: diagnostic.code?.toString(),
		source: diagnostic.source,
	}));
}

async function validateDocument(
	state: State,
	filePath: string,
	content: string,
): Promise<SerializedDiagnostic[]> {
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

		const diagnostics = await doValidate(state, document);

		return serializeDiagnostics(diagnostics);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		if (message.includes("Cannot read") || message.includes("undefined")) {
			console.warn(
				`Warning: Language service crashed while validating ${filePath}. Skipping this file.`,
			);
			return [];
		}

		throw new Error(`Failed to validate document ${filePath}: ${message}`);
	}
}

async function discoverFiles(
	cwd: string,
	patterns: string[],
	configPath: string | undefined,
	autoDiscover: boolean,
): Promise<string[]> {
	if (autoDiscover) {
		return discoverFilesFromConfig(cwd, configPath);
	}
	return expandPatterns(cwd, patterns);
}

async function expandPatterns(
	cwd: string,
	patterns: string[],
): Promise<string[]> {
	const explicitFiles: string[] = [];
	const globPatterns: string[] = [];

	for (const pattern of patterns) {
		if (
			pattern.includes("*") ||
			pattern.includes("?") ||
			pattern.includes("[")
		) {
			globPatterns.push(pattern);
		} else {
			const fullPath = path.resolve(cwd, pattern);
			if (fileExists(fullPath)) {
				explicitFiles.push(pattern);
			}
		}
	}

	if (globPatterns.length === 0) {
		return explicitFiles;
	}

	const globResults = await glob(globPatterns, {
		cwd,
		absolute: false,
		ignore: DEFAULT_IGNORE_PATTERNS,
	});

	if (explicitFiles.length === 0) {
		return globResults;
	}

	const fileSet = new Set(explicitFiles);
	for (const file of globResults) {
		fileSet.add(file);
	}
	return Array.from(fileSet);
}

async function discoverFilesFromConfig(
	cwd: string,
	configPath?: string,
): Promise<string[]> {
	const configFilePath = await findTailwindConfigPath(cwd, configPath);

	if (!configFilePath) {
		throw new Error(
			"Could not find Tailwind config for auto-discovery.\n" +
				"Use --config to specify the path, or provide file patterns directly.",
		);
	}

	if (!isCssConfigFile(configFilePath)) {
		const config = await loadTailwindConfig(configFilePath);

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

		return expandPatterns(cwd, patterns);
	}

	const cssContent = readFileSync(configFilePath);
	const sourcePatterns = extractSourcePatterns(cssContent);

	if (sourcePatterns.length > 0) {
		return expandPatterns(cwd, sourcePatterns);
	}

	return expandPatterns(cwd, [DEFAULT_FILE_PATTERN]);
}

function extractContentPatterns(config: TailwindConfig): string[] {
	if (!config.content) return [];

	if (Array.isArray(config.content)) {
		return config.content.filter((p): p is string => typeof p === "string");
	}

	if (config.content.files) {
		return config.content.files.filter(
			(p): p is string => typeof p === "string",
		);
	}

	return [];
}

function extractSourcePatterns(cssContent: string): string[] {
	const patterns: string[] = [];
	const sourceRegex = /@source\s+["']([^"']+)["']/g;

	for (const match of cssContent.matchAll(sourceRegex)) {
		patterns.push(match[1]);
	}

	return patterns;
}

async function processFiles(
	state: State,
	cwd: string,
	files: string[],
	fix: boolean,
	onProgress?: (current: number, total: number, file: string) => void,
): Promise<LintFileResult[]> {
	const results: LintFileResult[] = [];

	for (let i = 0; i < files.length; i += CONCURRENT_FILES) {
		const batch = files.slice(i, i + CONCURRENT_FILES);

		const batchPromises = batch.map(async (file, batchIndex) => {
			const fileIndex = i + batchIndex;
			if (onProgress) {
				onProgress(fileIndex + 1, files.length, file);
			}

			const result = await processFile(state, cwd, file, fix);
			return result;
		});

		const batchResults = await Promise.all(batchPromises);

		for (const result of batchResults) {
			if (result) {
				results.push(result);
			}
		}
	}

	return results;
}

async function processFile(
	state: State,
	cwd: string,
	filePath: string,
	fix: boolean,
): Promise<LintFileResult | null> {
	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(cwd, filePath);

	if (!fileExists(absolutePath)) {
		return null;
	}

	let content = readFileSync(absolutePath);
	let diagnostics = await validateDocument(state, absolutePath, content);

	let fixedCount = 0;
	let wasFixed = false;

	if (fix && diagnostics.length > 0) {
		const fixResult = await applyCodeActions(
			state,
			absolutePath,
			content,
			diagnostics,
		);

		if (fixResult.changed) {
			writeFileSync(absolutePath, fixResult.content);
			content = fixResult.content;
			wasFixed = true;
			fixedCount = fixResult.fixedCount;
			diagnostics = await validateDocument(state, absolutePath, content);
		}
	}

	return {
		path: path.relative(cwd, absolutePath),
		diagnostics,
		fixed: wasFixed,
		fixedCount,
	};
}
async function initializeState(
	cwd: string,
	configPath?: string,
	verbose = false,
) {
	try {
		const state = await createState(cwd, configPath, verbose);
		if (verbose) {
			console.log();
		}
		return state;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to initialize Tailwind state: ${message}`);
	}
}

export type { LintFileResult, LintOptions, LintResult };

export async function lint({
	cwd,
	patterns,
	configPath,
	autoDiscover,
	fix = false,
	verbose = false,
	onProgress,
}: LintOptions): Promise<LintResult> {
	const state = await initializeState(cwd, configPath, verbose);
	const files = await discoverFiles(cwd, patterns, configPath, autoDiscover);

	if (verbose) {
		console.log(
			chalk.cyan.bold(
				`→ Discovered ${files.length} file${files.length !== 1 ? "s" : ""} to lint`,
			),
		);
		console.log();
	}

	if (files.length === 0) {
		return { files: [], totalFilesProcessed: 0 };
	}

	const results = await processFiles(state, cwd, files, fix, onProgress);

	return {
		files: results.filter(
			(result) => result.diagnostics.length > 0 || result.fixed,
		),
		totalFilesProcessed: files.length,
	};
}
