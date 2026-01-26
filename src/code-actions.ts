import type { State } from "@tailwindcss/language-service";
import { doCodeActions, doValidate } from "@tailwindcss/language-service";
import type { CodeActionParams, Diagnostic } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	getLanguageId,
	MAX_FIX_ITERATIONS,
	QUICKFIX_ACTION_KIND,
} from "./constants";
import type { ApplyCodeActionsResult } from "./types";

export type { ApplyCodeActionsResult };

interface QuickfixAction {
	kind?: string;
	edit?: {
		changes?: Record<string, unknown[]>;
	};
}

async function getQuickfixes(
	state: State,
	document: TextDocument,
	uri: string,
	diagnostics: Diagnostic[],
) {
	const lspDiagnostics: Diagnostic[] = diagnostics.map((diag) => ({
		range: diag.range,
		severity: diag.severity,
		message: diag.message,
		code: diag.code,
		source: diag.source || "tailwindcss",
	}));

	const params: CodeActionParams = {
		textDocument: {
			uri,
		},
		range: {
			start: {
				line: 0,
				character: 0,
			},
			end: {
				line: document.lineCount,
				character: 0,
			},
		},
		context: {
			diagnostics: lspDiagnostics,
		},
	};

	const codeActions = await doCodeActions(state, params, document);

	return codeActions.filter(
		(action) =>
			action.kind === QUICKFIX_ACTION_KIND ||
			action.kind?.startsWith(`${QUICKFIX_ACTION_KIND}.`),
	) as QuickfixAction[];
}

function applyFirstQuickfix(
	action: QuickfixAction,
	uri: string,
	document: TextDocument,
	content: string,
) {
	if (!action.edit?.changes?.[uri]) return null;

	const edits = action.edit.changes[uri] as {
		range: {
			start: {
				line: number;
				character: number;
			};
			end: {
				line: number;
				character: number;
			};
		};
		newText: string;
	}[];

	const sortedEdits = [...edits].sort((a, b) => {
		const lineDiff = b.range.start.line - a.range.start.line;
		if (lineDiff !== 0) return lineDiff;
		return b.range.start.character - a.range.start.character;
	});

	let newContent = content;
	for (const edit of sortedEdits) {
		const startOffset = document.offsetAt(edit.range.start);
		const endOffset = document.offsetAt(edit.range.end);
		newContent =
			newContent.substring(0, startOffset) +
			edit.newText +
			newContent.substring(endOffset);
	}

	return { content: newContent };
}

export async function applyCodeActions(
	state: State,
	filePath: string,
	content: string,
	diagnostics: Diagnostic[],
): Promise<ApplyCodeActionsResult> {
	if (diagnostics.length === 0) {
		return {
			content,
			changed: false,
			fixedCount: 0,
		};
	}

	try {
		const languageId = getLanguageId(filePath);
		const uri = `file://${filePath}`;
		let currentDocument = TextDocument.create(uri, languageId, 1, content);
		let currentContent = content;
		let totalFixed = 0;

		// Keep fixing until no more fixable issues remain
		// Add iteration limit to prevent infinite loops
		for (let iteration = 0; iteration < MAX_FIX_ITERATIONS; iteration++) {
			const currentDiagnostics = await doValidate(state, currentDocument);
			if (currentDiagnostics.length === 0) break;

			const quickfixes = await getQuickfixes(
				state,
				currentDocument,
				uri,
				currentDiagnostics,
			);
			if (quickfixes.length === 0) break;

			const fixResult = applyFirstQuickfix(
				quickfixes[0],
				uri,
				currentDocument,
				currentContent,
			);
			if (!fixResult) break;

			currentContent = fixResult.content;
			currentDocument = TextDocument.create(
				uri,
				languageId,
				currentDocument.version + 1,
				currentContent,
			);
			totalFixed++;

			// Safety check: warn if approaching iteration limit
			if (iteration === MAX_FIX_ITERATIONS - 1) {
				console.warn(
					`Warning: Reached maximum fix iterations (${MAX_FIX_ITERATIONS}) for ${filePath}. Some issues may remain unfixed.`,
				);
			}
		}

		return {
			content: currentContent,
			changed: currentContent !== content,
			fixedCount: totalFixed,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		// Handle language service crashes gracefully
		if (message.includes("Cannot read") || message.includes("undefined")) {
			console.warn(
				`Warning: Language service crashed while applying fixes to ${filePath}. Skipping auto-fix for this file.`,
			);
			return {
				content,
				changed: false,
				fixedCount: 0,
			};
		}

		throw error;
	}
}
