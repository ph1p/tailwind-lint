import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import { doValidate } from "@tailwindcss/language-service";
import { TextDocument } from "vscode-languageserver-textdocument";
import { applyCodeActions } from "./code-actions";
import { CONCURRENT_FILES, getLanguageId } from "./constants";
import { createState } from "./state";
import type { LintFileResult } from "./types";
import type { TailwindConfigTarget } from "./utils/config";
import type { RootFontSize } from "./utils/root-font-size";

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

export async function initializeState(
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
