import type { Diagnostic } from "vscode-languageserver";

export interface TailwindConfig {
	content?: string[] | { files?: string[]; relative?: boolean };
	separator?: string;
	[key: string]: unknown;
}

export interface ResolvedTailwindConfig extends TailwindConfig {
	separator: string;
}

export interface DesignSystem {
	candidatesToAst?: (candidates: string[]) => unknown[][];
	candidatesToCss?: (candidates: string[]) => string[];
	[key: string]: unknown;
}

export interface ApplyCodeActionsResult {
	content: string;
	changed: boolean;
	fixedCount: number;
	/** Diagnostics remaining for `content` */
	diagnostics: Diagnostic[];
}

export interface LintFileResult {
	path: string;
	diagnostics: Diagnostic[];
	fixed?: boolean;
	fixedCount?: number;
	/** Content before fixing; only set in dry-run mode when fixes are available */
	originalContent?: string;
	/** Content after fixing; only set in dry-run mode when fixes are available */
	fixedContent?: string;
}

export interface LintOptions {
	cwd: string;
	patterns: string[];
	configPath?: string;
	autoDiscover: boolean;
	fix?: boolean;
	/** Compute fixes without writing them to disk (implies `fix`) */
	dryRun?: boolean;
	verbose?: boolean;
	/** Root font size in px; overrides editor settings and auto-detection */
	rootFontSize?: number;
	onProgress?: (current: number, total: number, file: string) => void;
}

export interface LintResult {
	files: LintFileResult[];
	totalFilesProcessed: number;
	skippedFiles: string[];
}

/**
 * Error thrown when adapter fails to load required modules
 */
export class AdapterLoadError extends Error {
	constructor(
		public readonly version: string,
		cause: Error,
	) {
		super(`Failed to load ${version} adapter: ${cause.message}`);
		this.name = "AdapterLoadError";
	}
}
