import { describe, expect, it } from "vitest";
import {
	createJsonErrorOutput,
	createJsonOutput,
	toJsonDiagnostic,
} from "../src/output";
import type { Diagnostic } from "vscode-languageserver";

describe("toJsonDiagnostic", () => {
	it("should convert diagnostic ranges to 1-based positions", () => {
		const diagnostic: Diagnostic = {
			range: {
				start: { line: 0, character: 4 },
				end: { line: 0, character: 8 },
			},
			severity: 1,
			message: "Test error",
			code: "testRule",
			source: "tailwindcss",
		};

		expect(toJsonDiagnostic(diagnostic)).toEqual({
			line: 1,
			column: 5,
			endLine: 1,
			endColumn: 9,
			severity: "error",
			code: "testRule",
			message: "Test error",
			source: "tailwindcss",
		});
	});
});

describe("createJsonOutput", () => {
	it("should build machine-readable summary and config metadata", () => {
		const output = createJsonOutput({
			files: [
				{
					path: "src/example.html",
					fixed: true,
					fixedCount: 2,
					diagnostics: [
						{
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 5 },
							},
							severity: 1,
							message: "Invalid class",
							code: "invalidClass",
						},
						{
							range: {
								start: { line: 1, character: 2 },
								end: { line: 1, character: 6 },
							},
							severity: 2,
							message: "Suggested order",
							code: "recommendedVariantOrder",
						},
					],
				},
			],
			totalFilesProcessed: 3,
			cwd: "/tmp/project",
			configPath: "src/app.css",
			autoDiscover: true,
			fix: true,
			patterns: [],
		});

		expect(output.ok).toBe(false);
		expect(output.summary).toEqual({
			errors: 1,
			warnings: 1,
			fixed: 2,
			filesWithIssues: 1,
			totalFilesProcessed: 3,
		});
		expect(output.config).toEqual({
			cwd: "/tmp/project",
			configPath: "src/app.css",
			autoDiscover: true,
			fix: true,
			patterns: [],
		});
		expect(output.files[0].path).toBe("src/example.html");
		expect(output.files[0].diagnostics).toHaveLength(2);
	});
});

describe("createJsonErrorOutput", () => {
	it("should keep the machine-readable shape on errors", () => {
		const output = createJsonErrorOutput({
			error: "Config not found",
			cwd: "/tmp/project",
			configPath: "/tmp/project/src/app.css",
			autoDiscover: true,
			fix: false,
			patterns: [],
		});

		expect(output).toEqual({
			ok: false,
			error: "Config not found",
			summary: {
				errors: 0,
				warnings: 0,
				fixed: 0,
				filesWithIssues: 0,
				totalFilesProcessed: 0,
			},
			config: {
				cwd: "/tmp/project",
				configPath: "/tmp/project/src/app.css",
				autoDiscover: true,
				fix: false,
				patterns: [],
			},
			files: [],
		});
	});
});
