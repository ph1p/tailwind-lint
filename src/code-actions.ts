import type { State } from "@tailwindcss/language-service";
import { doCodeActions, doValidate } from "@tailwindcss/language-service";
import type { CodeActionParams, Diagnostic } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageId, MAX_FIX_ITERATIONS } from "./constants";
import type { ApplyCodeActionsResult, SerializedDiagnostic } from "./types";

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
): Promise<QuickfixAction[]> {
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
			action.kind === "quickfix" || action.kind?.startsWith("quickfix."),
	) as QuickfixAction[];
}

function applyFirstQuickfix(
	action: QuickfixAction,
	uri: string,
	document: TextDocument,
	content: string,
): {
	content: string;
} | null {
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
	diagnostics: SerializedDiagnostic[],
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

		let iteration = 0;
		for (; iteration < MAX_FIX_ITERATIONS; iteration++) {
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
		}

		const maxIterationsReached = iteration === MAX_FIX_ITERATIONS;

		if (maxIterationsReached) {
			const remainingDiagnostics = await doValidate(state, currentDocument);
			if (remainingDiagnostics.length > 0) {
				console.warn(
					`Warning: Reached maximum fix iterations (${MAX_FIX_ITERATIONS}) for ${filePath}. Some issues may remain.`,
				);
			}
		}

		return {
			content: currentContent,
			changed: currentContent !== content,
			fixedCount: totalFixed,
			maxIterationsReached: maxIterationsReached ? true : undefined,
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
