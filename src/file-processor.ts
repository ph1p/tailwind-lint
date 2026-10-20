import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import { doValidate } from "@tailwindcss/language-service";
import { TextDocument } from "vscode-languageserver-textdocument";
import { applyCodeActions } from "./code-actions";
import { CONCURRENT_FILES, getLanguageId } from "./constants";
import { createState } from "./state";
import type { LintFileResult } from "./types";
import type { TailwindConfigTarget } from "./utils/config";
import { fileExists, readFileSync, writeFileSync } from "./utils/fs";

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

export async function processFiles(
	state: State,
	cwd: string,
	files: string[],
	fix: boolean,
	onProgress?: (current: number, total: number, file: string) => void,
) {
	const results: LintFileResult[] = [];
	let completed = 0;

	for (let i = 0; i < files.length; i += CONCURRENT_FILES) {
		const batch = files.slice(i, i + CONCURRENT_FILES);

		const batchResults = await Promise.all(
			batch.map(async (file) => {
				const result = await processFile(state, cwd, file, fix);
				onProgress?.(++completed, files.length, file);
				return result;
			}),
		);

		results.push(
			...(batchResults.filter((r) => r !== null) as LintFileResult[]),
		);
	}

	return results;
}

async function processFile(
	state: State,
	cwd: string,
	filePath: string,
	fix: boolean,
) {
	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(cwd, filePath);

	if (!fileExists(absolutePath)) {
		return null;
	}

	const content = readFileSync(absolutePath);
	let diagnostics = await validateDocument(state, absolutePath, content);

	let fixedCount = 0;

	if (fix && diagnostics.length > 0) {
		const fixResult = await applyCodeActions(
			state,
			absolutePath,
			content,
			diagnostics,
		);

		if (fixResult.changed) {
			writeFileSync(absolutePath, fixResult.content);
			fixedCount = fixResult.fixedCount;
			diagnostics = await validateDocument(
				state,
				absolutePath,
				fixResult.content,
			);
		}
	}

	return {
		path: path.relative(cwd, absolutePath),
		diagnostics,
		fixed: fixedCount > 0,
		fixedCount,
	};
}
export async function initializeState(
	cwd: string,
	target: TailwindConfigTarget,
	verbose = false,
) {
	try {
		const state = await createState(cwd, target, verbose);
		if (verbose) {
			console.log();
		}
		return state;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to initialize Tailwind state: ${message}`);
	}
}
