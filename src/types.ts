import type { Diagnostic } from "vscode-languageserver";

export interface TailwindConfig {
	content?: string[] | { files?: string[] };
	separator?: string;
	[key: string]: unknown;
}

export interface ResolvedTailwindConfig extends TailwindConfig {
	separator: string;
}

export interface DesignSystem {
	candidatesToAst?: (candidates: string[]) => unknown[];
	candidatesToCss?: (candidates: string[]) => string[];
	[key: string]: unknown;
}

export interface ContextUtils {
	[key: string]: unknown;
}

export interface GenerateRulesModule {
	generateRules?: (set: unknown, context: unknown) => unknown[];
	[key: string]: unknown;
}

export interface ApplyCodeActionsResult {
	content: string;
	changed: boolean;
	fixedCount: number;
}

export interface LintFileResult {
	path: string;
	diagnostics: Diagnostic[];
	fixed?: boolean;
	fixedCount?: number;
}

export interface LintOptions {
	cwd: string;
	patterns: string[];
	configPath?: string;
	autoDiscover: boolean;
	fix?: boolean;
	verbose?: boolean;
	onProgress?: (current: number, total: number, file: string) => void;
}

export interface LintResult {
	files: LintFileResult[];
	totalFilesProcessed: number;
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
