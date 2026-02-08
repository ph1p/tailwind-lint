import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TAILWIND_V4_IMPORT_REGEX } from "../src/constants";
import { extractSourcePatterns } from "../src/linter";
import { readGitignorePatterns } from "../src/utils/fs";

describe("extractSourcePatterns", () => {
	it("should extract simple @source patterns", () => {
		const css = `
@import "tailwindcss";
@source "./src/**/*.{js,tsx}";
@source "./components/**/*.html";
`;
		const result = extractSourcePatterns(css);
		expect(result.include).toEqual([
			"./src/**/*.{js,tsx}",
			"./components/**/*.html",
		]);
		expect(result.exclude).toEqual([]);
	});

	it("should extract @source not patterns as excludes", () => {
		const css = `
@import "tailwindcss";
@source "./src/**/*.{js,tsx}";
@source not "./src/legacy/**";
`;
		const result = extractSourcePatterns(css);
		expect(result.include).toEqual(["./src/**/*.{js,tsx}"]);
		expect(result.exclude).toEqual(["./src/legacy/**"]);
	});

	it("should skip @source inline(...) directives", () => {
		const css = `
@import "tailwindcss";
@source "./src/**/*.tsx";
@source inline("underline");
@source inline("{hover:,focus:,}bg-red-{50,100,200}");
`;
		const result = extractSourcePatterns(css);
		expect(result.include).toEqual(["./src/**/*.tsx"]);
		expect(result.exclude).toEqual([]);
	});

	it("should skip @source not inline(...) directives", () => {
		const css = `
@import "tailwindcss";
@source "./src/**/*.tsx";
@source not inline("{hover:,}bg-red-{50,100}");
`;
		const result = extractSourcePatterns(css);
		expect(result.include).toEqual(["./src/**/*.tsx"]);
		expect(result.exclude).toEqual([]);
	});

	it("should handle mixed @source directives", () => {
		const css = `
@import "tailwindcss";
@source "./src/**/*.{js,tsx}";
@source not "./vendor/**";
@source inline("underline");
@source "../shared/**/*.html";
@source not "../legacy/**";
`;
		const result = extractSourcePatterns(css);
		expect(result.include).toEqual([
			"./src/**/*.{js,tsx}",
			"../shared/**/*.html",
		]);
		expect(result.exclude).toEqual(["./vendor/**", "../legacy/**"]);
	});

	it("should handle single-quoted @source patterns", () => {
		const css = `
@import "tailwindcss";
@source './src/**/*.tsx';
@source not './legacy/**';
`;
		const result = extractSourcePatterns(css);
		expect(result.include).toEqual(["./src/**/*.tsx"]);
		expect(result.exclude).toEqual(["./legacy/**"]);
	});

	it("should return empty arrays when no @source directives", () => {
		const css = `
@import "tailwindcss";

@theme {
  --color-primary: #3b82f6;
}
`;
		const result = extractSourcePatterns(css);
		expect(result.include).toEqual([]);
		expect(result.exclude).toEqual([]);
	});
});

describe("TAILWIND_V4_IMPORT_REGEX", () => {
	it("should match standard @import tailwindcss", () => {
		expect(TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss"')).toBe(true);
		expect(TAILWIND_V4_IMPORT_REGEX.test("@import 'tailwindcss'")).toBe(true);
	});

	it("should match @import with sub-paths", () => {
		expect(
			TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss/preflight"'),
		).toBe(true);
		expect(
			TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss/utilities"'),
		).toBe(true);
		expect(
			TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss/theme.css"'),
		).toBe(true);
	});

	it("should match @import with source modifier", () => {
		expect(
			TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss" source("../src")'),
		).toBe(true);
		expect(
			TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss" source(none)'),
		).toBe(true);
	});

	it("should match @import with prefix modifier", () => {
		expect(
			TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss" prefix(tw)'),
		).toBe(true);
	});

	it("should match @import with layer modifier", () => {
		expect(
			TAILWIND_V4_IMPORT_REGEX.test(
				'@import "tailwindcss/utilities.css" layer(utilities)',
			),
		).toBe(true);
	});

	it("should not match unrelated imports", () => {
		expect(TAILWIND_V4_IMPORT_REGEX.test('@import "normalize.css"')).toBe(
			false,
		);
		expect(TAILWIND_V4_IMPORT_REGEX.test('@import "./styles.css"')).toBe(false);
	});

	it("should not match similar package names", () => {
		expect(TAILWIND_V4_IMPORT_REGEX.test('@import "tailwindcss-extra"')).toBe(
			false,
		);
	});
});

describe("readGitignorePatterns", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-lint-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should return empty array when no .gitignore exists", () => {
		expect(readGitignorePatterns(tmpDir)).toEqual([]);
	});

	it("should parse bare directory names", () => {
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules\ndist\n");
		const patterns = readGitignorePatterns(tmpDir);
		expect(patterns).toContain("**/node_modules/**");
		expect(patterns).toContain("**/dist/**");
	});

	it("should strip comments and blank lines", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".gitignore"),
			"# Build output\ndist\n\n# Dependencies\nnode_modules\n",
		);
		const patterns = readGitignorePatterns(tmpDir);
		expect(patterns).toEqual(["**/dist/**", "**/node_modules/**"]);
	});

	it("should skip negation patterns", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".gitignore"),
			"dist\n!dist/important\nnode_modules\n",
		);
		const patterns = readGitignorePatterns(tmpDir);
		expect(patterns).toEqual(["**/dist/**", "**/node_modules/**"]);
	});

	it("should handle patterns with slashes", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".gitignore"),
			"build/output\nsrc/generated\n",
		);
		const patterns = readGitignorePatterns(tmpDir);
		expect(patterns).toContain("build/output/**");
		expect(patterns).toContain("src/generated/**");
	});

	it("should handle glob patterns", () => {
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "*.log\n*.tmp\n");
		const patterns = readGitignorePatterns(tmpDir);
		expect(patterns).toContain("*.log/**");
		expect(patterns).toContain("*.tmp/**");
	});

	it("should strip trailing slashes", () => {
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "dist/\nbuild/\n");
		const patterns = readGitignorePatterns(tmpDir);
		expect(patterns).toContain("**/dist/**");
		expect(patterns).toContain("**/build/**");
	});

	it("should not duplicate patterns ending with /**", () => {
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "vendor/**\n");
		const patterns = readGitignorePatterns(tmpDir);
		expect(patterns).toEqual(["vendor/**"]);
	});
});
