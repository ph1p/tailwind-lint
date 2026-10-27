import type { State } from "@tailwindcss/language-service";
import { doCodeActions, doValidate } from "@tailwindcss/language-service";
import type {
	CodeActionParams,
	Diagnostic,
	TextEdit,
} from "vscode-languageserver";
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
	diagnostics?: Diagnostic[];
	edit?: {
		changes?: Record<string, TextEdit[]>;
	};
}

interface OffsetEdit {
	start: number;
	end: number;
	newText: string;
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

	// vscode-languageserver (3.18 types) allows MarkupContent messages, the
	// language service still expects 3.17 types
	const codeActions = await doCodeActions(
		state,
		params as Parameters<typeof doCodeActions>[1],
		document,
	);

	return codeActions.filter(
		(action) =>
			action.kind === QUICKFIX_ACTION_KIND ||
			action.kind?.startsWith(`${QUICKFIX_ACTION_KIND}.`),
	) as QuickfixAction[];
}

function diagnosticKey(diagnostic: Diagnostic) {
	const { start, end } = diagnostic.range;
	return `${diagnostic.code}:${start.line}:${start.character}:${end.line}:${end.character}:${diagnostic.message}`;
}

function overlaps(a: OffsetEdit, b: OffsetEdit) {
	// Edits starting at the same offset have no well-defined order
	return a.start === b.start || (a.start < b.end && b.start < a.end);
}

/**
 * Picks the first quickfix for every diagnostic and keeps only those whose
 * edits do not overlap, so a single validation pass can fix many issues.
 * Overlapping fixes (e.g. two cssConflict fixes rewriting the same class list)
 * are left for the next pass, which sees the updated document.
 */
function selectNonOverlappingEdits(
	actions: QuickfixAction[],
	uri: string,
	document: TextDocument,
) {
	const handled = new Set<string>();
	const accepted: OffsetEdit[] = [];
	let fixCount = 0;

	for (const action of actions) {
		const edits = action.edit?.changes?.[uri];
		if (!edits || edits.length === 0) continue;

		const keys = (action.diagnostics ?? []).map(diagnosticKey);
		if (keys.some((key) => handled.has(key))) continue;

		const offsetEdits = edits.map((edit) => ({
			start: document.offsetAt(edit.range.start),
			end: document.offsetAt(edit.range.end),
			newText: edit.newText,
		}));
		const conflicts = offsetEdits.some((edit, index) =>
			[...accepted, ...offsetEdits.slice(0, index)].some((other) =>
				overlaps(edit, other),
			),
		);
		if (conflicts) continue;

		for (const key of keys) handled.add(key);
		accepted.push(...offsetEdits);
		fixCount++;
	}

	return { edits: accepted, fixCount };
}

function applyEdits(content: string, edits: OffsetEdit[]) {
	const sorted = [...edits].sort((a, b) => a.start - b.start);
	let result = "";
	let cursor = 0;
	for (const edit of sorted) {
		result += content.slice(cursor, edit.start) + edit.newText;
		cursor = edit.end;
	}
	return result + content.slice(cursor);
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
			diagnostics,
		};
	}

	try {
		const languageId = getLanguageId(filePath);
		const uri = `file://${filePath}`;
		let currentDocument = TextDocument.create(uri, languageId, 1, content);
		let currentContent = content;
		// The caller already validated the original content, so reuse it
		let currentDiagnostics = diagnostics;
		let totalFixed = 0;

		// Keep fixing until no more fixable issues remain
		// Add iteration limit to prevent infinite loops
		for (let iteration = 0; ; iteration++) {
			if (iteration > 0) {
				currentDiagnostics = await doValidate(state, currentDocument);
			}
			if (currentDiagnostics.length === 0) break;

			if (iteration === MAX_FIX_ITERATIONS) {
				console.warn(
					`Warning: Reached maximum fix iterations (${MAX_FIX_ITERATIONS}) for ${filePath}. Some issues may remain unfixed.`,
				);
				break;
			}

			const quickfixes = await getQuickfixes(
				state,
				currentDocument,
				uri,
				currentDiagnostics,
			);
			const { edits, fixCount } = selectNonOverlappingEdits(
				quickfixes,
				uri,
				currentDocument,
			);
			if (fixCount === 0) break;

			currentContent = applyEdits(currentContent, edits);
			currentDocument = TextDocument.create(
				uri,
				languageId,
				currentDocument.version + 1,
				currentContent,
			);
			totalFixed += fixCount;
		}

		return {
			content: currentContent,
			changed: currentContent !== content,
			fixedCount: totalFixed,
			diagnostics: currentDiagnostics,
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
				diagnostics,
			};
		}

		throw error;
	}
}
