import type { Diagnostic } from "vscode-languageserver";
import { SEVERITY } from "./constants";
import type { LintFileResult } from "./types";

type JsonSeverity = "error" | "warning" | "info";

interface JsonDiagnostic {
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	severity: JsonSeverity;
	code: string | number | null;
	message: string;
	source: string | undefined;
}

interface JsonLintFileResult {
	path: string;
	fixed: boolean;
	fixedCount: number;
	diagnostics: JsonDiagnostic[];
}

interface JsonSummary {
	errors: number;
	warnings: number;
	fixed: number;
	fixable: number;
	filesWithIssues: number;
	totalFilesProcessed: number;
}

interface JsonLintOutput {
	ok: boolean;
	summary: JsonSummary;
	error?: string;
	config: {
		cwd: string;
		configPath: string | null;
		autoDiscover: boolean;
		fix: boolean;
		dryRun: boolean;
		patterns: string[];
	};
	files: JsonLintFileResult[];
	skippedFiles: string[];
}

export function countBySeverity(diagnostics: Diagnostic[]) {
	let errors = 0;
	let warnings = 0;

	for (const diagnostic of diagnostics) {
		if (diagnostic.severity === SEVERITY.ERROR) errors++;
		if (diagnostic.severity === SEVERITY.WARNING) warnings++;
	}

	return { errors, warnings };
}

// Diagnostics the language service offers a quickfix for
const ALWAYS_FIXABLE_CODES = new Set(["cssConflict", "invalidApply"]);

export function isFixable(diagnostic: Diagnostic) {
	if (ALWAYS_FIXABLE_CODES.has(String(diagnostic.code))) return true;
	const { suggestions } = diagnostic as Diagnostic & { suggestions?: unknown };
	return Array.isArray(suggestions) && suggestions.length > 0;
}

export function countFixable(diagnostics: Diagnostic[]) {
	return diagnostics.filter(isFixable).length;
}

function toJsonSeverity(severity: number | undefined): JsonSeverity {
	if (severity === SEVERITY.ERROR) return "error";
	if (severity === SEVERITY.WARNING) return "warning";
	return "info";
}

export function toJsonDiagnostic(diagnostic: Diagnostic): JsonDiagnostic {
	return {
		line: diagnostic.range.start.line + 1,
		column: diagnostic.range.start.character + 1,
		endLine: diagnostic.range.end.line + 1,
		endColumn: diagnostic.range.end.character + 1,
		severity: toJsonSeverity(diagnostic.severity),
		code: diagnostic.code ?? null,
		message:
			typeof diagnostic.message === "string"
				? diagnostic.message
				: diagnostic.message.value,
		source: diagnostic.source,
	};
}

export function createJsonOutput({
	files,
	totalFilesProcessed,
	skippedFiles = [],
	cwd,
	configPath,
	autoDiscover,
	fix,
	dryRun = false,
	patterns,
}: {
	files: LintFileResult[];
	totalFilesProcessed: number;
	skippedFiles?: string[];
	cwd: string;
	configPath?: string;
	autoDiscover: boolean;
	fix: boolean;
	dryRun?: boolean;
	patterns: string[];
}): JsonLintOutput {
	let errors = 0;
	let warnings = 0;
	let fixed = 0;
	let fixable = 0;
	let filesWithIssues = 0;

	const mappedFiles = files.map((file) => {
		const severityCount = countBySeverity(file.diagnostics);
		errors += severityCount.errors;
		warnings += severityCount.warnings;
		fixed += file.fixedCount || 0;
		fixable += countFixable(file.diagnostics);

		if (file.diagnostics.length > 0) {
			filesWithIssues++;
		}

		return {
			path: file.path,
			fixed: file.fixed || false,
			fixedCount: file.fixedCount || 0,
			diagnostics: file.diagnostics.map(toJsonDiagnostic),
		};
	});

	return {
		ok: errors === 0,
		summary: {
			errors,
			warnings,
			fixed,
			fixable,
			filesWithIssues,
			totalFilesProcessed,
		},
		config: {
			cwd,
			configPath: configPath || null,
			autoDiscover,
			fix,
			dryRun,
			patterns,
		},
		files: mappedFiles,
		skippedFiles,
	};
}

export function createJsonErrorOutput({
	error,
	cwd,
	configPath,
	autoDiscover,
	fix,
	dryRun = false,
	patterns,
}: {
	error: string;
	cwd: string;
	configPath?: string;
	autoDiscover: boolean;
	fix: boolean;
	dryRun?: boolean;
	patterns: string[];
}): JsonLintOutput {
	return {
		ok: false,
		error,
		summary: {
			errors: 0,
			warnings: 0,
			fixed: 0,
			fixable: 0,
			filesWithIssues: 0,
			totalFilesProcessed: 0,
		},
		config: {
			cwd,
			configPath: configPath || null,
			autoDiscover,
			fix,
			dryRun,
			patterns,
		},
		files: [],
		skippedFiles: [],
	};
}
