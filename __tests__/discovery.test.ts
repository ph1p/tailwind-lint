import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	SYNTHETIC_VITE_CSS_CONFIG_NAME,
	TAILWIND_V4_IMPORT_REGEX,
	TAILWIND_VITE_PLUGIN_REGEX,
} from "../src/constants";
import {
	extractImportSourceDirectives,
	extractSourcePatterns,
	lint,
} from "../src/linter";
import { findTailwindConfigPath } from "../src/utils/config";
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

describe("extractImportSourceDirectives", () => {
	it("should extract source roots from @import directives", () => {
		const css = `
@import "tailwindcss" source("../src");
@import "tailwindcss" source("./components");
`;

		expect(extractImportSourceDirectives(css)).toEqual({
			roots: ["../src", "./components"],
			disableAutoSource: false,
		});
	});

	it("should detect source(none)", () => {
		const css = `@import "tailwindcss" source(none);`;
		expect(extractImportSourceDirectives(css)).toEqual({
			roots: [],
			disableAutoSource: true,
		});
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

describe("TAILWIND_VITE_PLUGIN_REGEX", () => {
	it("should match @tailwindcss/vite imports", () => {
		expect(
			TAILWIND_VITE_PLUGIN_REGEX.test(
				'import tailwindcss from "@tailwindcss/vite";',
			),
		).toBe(true);
		expect(
			TAILWIND_VITE_PLUGIN_REGEX.test(
				'const tailwindcss = require("@tailwindcss/vite");',
			),
		).toBe(true);
		expect(
			TAILWIND_VITE_PLUGIN_REGEX.test('await import("@tailwindcss/vite")'),
		).toBe(true);
	});

	it("should not match unrelated Vite plugins", () => {
		expect(
			TAILWIND_VITE_PLUGIN_REGEX.test(
				'import react from "@vitejs/plugin-react";',
			),
		).toBe(false);
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

describe("findTailwindConfigPath", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-config-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should discover nested v3 config files recursively", async () => {
		const nestedDir = path.join(tmpDir, "packages", "web");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(
			path.join(nestedDir, "tailwind.config.js"),
			"module.exports = { content: ['./src/**/*.tsx'] }",
		);

		const discovered = await findTailwindConfigPath(tmpDir);
		expect(discovered).toBe(path.join(nestedDir, "tailwind.config.js"));
	});

	it("should discover nested v4 css configs recursively", async () => {
		const nestedDir = path.join(tmpDir, "apps", "site", "styles");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(
			path.join(nestedDir, "theme.css"),
			'@import "tailwindcss";',
		);

		const discovered = await findTailwindConfigPath(tmpDir);
		expect(discovered).toBe(path.join(nestedDir, "theme.css"));
	});

	it("should discover v4 projects configured through the Tailwind Vite plugin", async () => {
		const nestedDir = path.join(tmpDir, "packages", "ladle");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(
			path.join(nestedDir, "vite.config.ts"),
			`
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
});
`,
		);

		const discovered = await findTailwindConfigPath(tmpDir);
		expect(discovered).toBe(
			path.join(nestedDir, SYNTHETIC_VITE_CSS_CONFIG_NAME),
		);
	});
});

describe("lint with Vite config discovery", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-vite-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should initialize Tailwind v4 from @tailwindcss/vite and lint files", async () => {
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "vite.config.ts"),
			`
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
});
`,
		);
		fs.writeFileSync(
			path.join(tmpDir, "src", "example.html"),
			'<div class="block flex p-[16px]"></div>',
		);
		fs.symlinkSync(
			path.resolve(__dirname, "fixtures", "v4", "node_modules"),
			path.join(tmpDir, "node_modules"),
			"dir",
		);

		const result = await lint({
			cwd: tmpDir,
			patterns: [],
			autoDiscover: true,
		});

		expect(result.totalFilesProcessed).toBe(2);
		expect(result.files).toHaveLength(1);
		expect(result.files[0].diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining(["cssConflict", "suggestCanonicalClasses"]),
		);
	});

	it("should prefer Ladle CSS config and lint class strings in helpers", async () => {
		fs.mkdirSync(path.join(tmpDir, ".ladle"), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "vite.config.ts"),
			`
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
});
`,
		);
		fs.writeFileSync(
			path.join(tmpDir, ".ladle", "styles.css"),
			`
@import "tailwindcss" source("../src");

@theme inline {
	--color-ladle-text-secondary: var(--ladle-color-secondary);
}
`,
		);
		fs.writeFileSync(
			path.join(tmpDir, "src", "helper.tsx"),
			`
const badge = (className: string) => <span className={className} />;

export const Demo = () =>
	badge("font-semibold text-[var(--ladle-color-secondary)]");
`,
		);
		fs.symlinkSync(
			path.resolve(__dirname, "fixtures", "v4", "node_modules"),
			path.join(tmpDir, "node_modules"),
			"dir",
		);

		const result = await lint({
			cwd: tmpDir,
			patterns: [],
			autoDiscover: true,
		});

		const messages = result.files.flatMap((file) =>
			file.diagnostics.map((diagnostic) => diagnostic.message),
		);
		expect(messages).toContain(
			"The class `text-[var(--ladle-color-secondary)]` can be written as `text-(--ladle-color-secondary)`",
		);
	});
});
