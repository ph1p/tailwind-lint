import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	TAILWIND_V4_IMPORT_REGEX,
	TAILWIND_VITE_PLUGIN_REGEX,
} from "../src/constants";
import {
	extractImportSourceDirectives,
	extractSourcePatterns,
	lint,
} from "../src/linter";
import { findProjectRoot, findTailwindConfigs } from "../src/utils/config";
import { readGitignorePatterns } from "../src/utils/fs";

const findConfig = async (cwd: string) =>
	(await findTailwindConfigs(cwd)).targets[0];

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

describe("findTailwindConfigs", () => {
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

		const discovered = await findConfig(tmpDir);
		expect(discovered?.path).toBe(path.join(nestedDir, "tailwind.config.js"));
	});

	it("should discover nested v4 css configs recursively", async () => {
		const nestedDir = path.join(tmpDir, "apps", "site", "styles");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(
			path.join(nestedDir, "theme.css"),
			'@import "tailwindcss";',
		);

		const discovered = await findConfig(tmpDir);
		expect(discovered?.path).toBe(path.join(nestedDir, "theme.css"));
	});

	it("should prefer a v4 css config in a common location over a legacy v3 config", async () => {
		const cssDir = path.join(tmpDir, "src", "app");
		fs.mkdirSync(cssDir, { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "tailwind.config.js"),
			"module.exports = { content: ['./src/**/*.tsx'] }",
		);
		fs.writeFileSync(
			path.join(cssDir, "globals.css"),
			'@import "tailwindcss";',
		);

		const discovered = await findConfig(tmpDir);
		expect(discovered?.path).toBe(path.join(cssDir, "globals.css"));
	});

	it("should find the nearest project root from a nested css config directory", () => {
		const cssDir = path.join(tmpDir, "src", "app");
		fs.mkdirSync(cssDir, { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");

		expect(findProjectRoot(cssDir)).toBe(tmpDir);
	});

	it("should discover v4 projects configured through the Tailwind Vite plugin", async () => {
		const nestedDir = path.join(tmpDir, "packages", "docs");
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

		const discovered = await findConfig(tmpDir);
		expect(discovered).toEqual({
			kind: "vite",
			path: path.join(nestedDir, "vite.config.ts"),
			root: tmpDir,
		});
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

	it("should prefer real css config files and lint class strings in helpers", async () => {
		fs.mkdirSync(path.join(tmpDir, "styles"), { recursive: true });
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
			path.join(tmpDir, "styles", "theme.css"),
			`
@import "tailwindcss" source("../src");

@theme inline {
	--color-app-text-secondary: var(--app-text-secondary);
}
`,
		);
		fs.writeFileSync(
			path.join(tmpDir, "src", "helper.tsx"),
			`
const badge = (className: string) => <span className={className} />;

export const Demo = () =>
	badge("font-semibold text-[var(--app-text-secondary)]");
`,
		);
		fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".vscode", "settings.json"),
			JSON.stringify({ "tailwindCSS.classFunctions": ["badge"] }),
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
			"The class `text-[var(--app-text-secondary)]` can be written as `text-(--app-text-secondary)`",
		);
	});
});

describe("config-driven CLI behavior", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-config-mode-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should use config-driven discovery when a css config path is provided without files", async () => {
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			fs.readFileSync(
				path.resolve(__dirname, "fixtures", "v4", "package.json"),
				"utf-8",
			),
			"utf-8",
		);
		fs.symlinkSync(
			path.resolve(__dirname, "fixtures", "v4", "node_modules"),
			path.join(tmpDir, "node_modules"),
			"dir",
		);
		fs.writeFileSync(
			path.join(tmpDir, "src", "app.css"),
			'@import "tailwindcss" source("./");\n',
		);
		fs.writeFileSync(
			path.join(tmpDir, "src", "example.html"),
			'<div class="p-[16px]"></div>\n',
		);

		const result = await lint({
			cwd: path.join(tmpDir, "src"),
			patterns: [],
			configPath: path.join(tmpDir, "src", "app.css"),
			autoDiscover: true,
		});

		expect(result.totalFilesProcessed).toBe(2);
		expect(result.files).toHaveLength(1);
		expect(result.files[0].path).toBe("example.html");
	});

	it("should keep automatic project sources when css @source directives are present", async () => {
		fs.mkdirSync(path.join(tmpDir, "src", "app"), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, "shared"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			fs.readFileSync(
				path.resolve(__dirname, "fixtures", "v4", "package.json"),
				"utf-8",
			),
			"utf-8",
		);
		fs.symlinkSync(
			path.resolve(__dirname, "fixtures", "v4", "node_modules"),
			path.join(tmpDir, "node_modules"),
			"dir",
		);
		const cssConfigPath = path.join(tmpDir, "src", "app", "globals.css");
		fs.writeFileSync(
			cssConfigPath,
			`@import "tailwindcss";
@source "../../shared";
`,
		);
		fs.writeFileSync(
			path.join(tmpDir, "src", "app", "page.html"),
			'<div class="p-[16px]"></div>\n',
		);
		fs.writeFileSync(
			path.join(tmpDir, "shared", "component.html"),
			'<div class="p-4"></div>\n',
		);

		const result = await lint({
			cwd: tmpDir,
			patterns: [],
			configPath: cssConfigPath,
			autoDiscover: true,
		});

		expect(result.files.map((file) => file.path)).toContain(
			"src/app/page.html",
		);
		expect(result.totalFilesProcessed).toBe(3);
	});
});

describe("monorepo discovery", () => {
	let tmpDir: string;

	const writeFile = (relativePath: string, content: string) => {
		const filePath = path.join(tmpDir, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-monorepo-"));
		writeFile("package.json", "{}");
		fs.symlinkSync(
			path.resolve(__dirname, "fixtures", "v4", "node_modules"),
			path.join(tmpDir, "node_modules"),
			"dir",
		);

		for (const app of ["web", "admin"]) {
			writeFile(`apps/${app}/package.json`, "{}");
			writeFile(
				`apps/${app}/src/page.html`,
				'<div class="text-[var(--color-brand)]"></div>\n',
			);
		}
		writeFile("apps/web/src/app.css", '@import "tailwindcss";\n');
		writeFile(
			"apps/admin/src/app.css",
			'@import "tailwindcss";\n@theme {\n\t--color-brand: red;\n}\n',
		);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const messagesFor = (
		result: Awaited<ReturnType<typeof lint>>,
		filePath: string,
	) =>
		result.files
			.find((file) => file.path === filePath)
			?.diagnostics.map((diagnostic) => diagnostic.message);

	it("should find one config per package", async () => {
		const { targets } = await findTailwindConfigs(tmpDir);
		expect(targets.map((target) => target.path).sort()).toEqual([
			path.join(tmpDir, "apps", "admin", "src", "app.css"),
			path.join(tmpDir, "apps", "web", "src", "app.css"),
		]);
	});

	it("should auto-discover and lint each package with its own config", async () => {
		const result = await lint({
			cwd: tmpDir,
			patterns: [],
			autoDiscover: true,
		});

		expect(result.totalFilesProcessed).toBe(4);
		expect(messagesFor(result, "apps/admin/src/page.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-brand`",
		);
		expect(messagesFor(result, "apps/web/src/page.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-(--color-brand)`",
		);
	});

	it("should only load tailwind for packages that have files to lint", async () => {
		writeFile("apps/empty/package.json", "{}");
		writeFile(
			"apps/empty/tailwind.config.js",
			'module.exports = { content: ["./src/**/*.html"] };\n',
		);
		const logs: string[] = [];
		const log = vi
			.spyOn(console, "log")
			.mockImplementation((message: unknown) => logs.push(String(message)));

		try {
			await lint({
				cwd: tmpDir,
				patterns: [],
				autoDiscover: true,
				verbose: true,
			});
		} finally {
			log.mockRestore();
		}

		expect(logs.filter((line) => line.includes("Config path:"))).toHaveLength(
			2,
		);
		expect(logs.some((line) => line.includes("apps/empty"))).toBe(true);
	});

	it("should lint packages without a config with the parent config", async () => {
		writeFile(
			"app.css",
			'@import "tailwindcss";\n@theme {\n\t--color-brand: blue;\n}\n',
		);
		writeFile("packages/ui/package.json", "{}");
		writeFile(
			"packages/ui/button.html",
			'<div class="text-[var(--color-brand)]"></div>\n',
		);

		const result = await lint({
			cwd: tmpDir,
			patterns: [],
			autoDiscover: true,
		});

		expect(messagesFor(result, "packages/ui/button.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-brand`",
		);
		expect(messagesFor(result, "apps/web/src/page.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-(--color-brand)`",
		);
	});

	it("should lint files referenced via @source with the referencing config", async () => {
		writeFile(
			"apps/web/src/app.css",
			'@import "tailwindcss";\n@source "../../../packages/ui";\n',
		);
		writeFile("packages/ui/package.json", "{}");
		writeFile(
			"packages/ui/button.html",
			'<div class="text-[var(--color-brand)]"></div>\n',
		);

		const result = await lint({
			cwd: tmpDir,
			patterns: [],
			autoDiscover: true,
		});

		expect(messagesFor(result, "packages/ui/button.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-(--color-brand)`",
		);
	});

	it("should lint v3 and v4 packages side by side", async () => {
		writeFile(
			"apps/legacy/package.json",
			'{ "dependencies": { "tailwindcss": "3" } }',
		);
		writeFile(
			"apps/legacy/tailwind.config.js",
			'module.exports = { content: ["./src/**/*.html"] };\n',
		);
		writeFile("apps/legacy/src/page.html", '<div class="block flex"></div>\n');
		fs.symlinkSync(
			path.resolve(__dirname, "fixtures", "v3", "node_modules"),
			path.join(tmpDir, "apps", "legacy", "node_modules"),
			"dir",
		);

		const result = await lint({
			cwd: tmpDir,
			patterns: [],
			autoDiscover: true,
		});

		expect(messagesFor(result, "apps/legacy/src/page.html")).toContain(
			"'block' applies the same CSS properties as 'flex'.",
		);
		expect(messagesFor(result, "apps/admin/src/page.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-brand`",
		);
	});

	it("should only treat package.json workspaces as packages", async () => {
		writeFile("package.json", '{ "workspaces": ["apps/web"] }');

		const { targets, packageRoots } = await findTailwindConfigs(tmpDir);

		expect(packageRoots.sort()).toEqual([
			tmpDir,
			path.join(tmpDir, "apps/web"),
		]);
		expect(targets.map((target) => target.root).sort()).toEqual([
			tmpDir,
			path.join(tmpDir, "apps/web"),
		]);
	});

	it("should honor pnpm-workspace.yaml packages and negations", async () => {
		writeFile(
			"pnpm-workspace.yaml",
			'packages:\n  - "apps/*"\n  # admin is not a workspace\n  - "!apps/admin"\n',
		);

		const { packageRoots } = await findTailwindConfigs(tmpDir);

		expect(packageRoots.sort()).toEqual([
			tmpDir,
			path.join(tmpDir, "apps/web"),
		]);
	});

	it("should list the searched packages when no config is found", async () => {
		fs.rmSync(path.join(tmpDir, "apps/web/src/app.css"));
		fs.rmSync(path.join(tmpDir, "apps/admin/src/app.css"));

		await expect(
			lint({ cwd: tmpDir, patterns: [], autoDiscover: true }),
		).rejects.toThrow(/or its packages:\n {2}• apps\/admin\n {2}• apps\/web/);
	});

	it("should lint explicit patterns with the owning package config", async () => {
		const result = await lint({
			cwd: tmpDir,
			patterns: ["apps/**/*.html"],
			autoDiscover: false,
		});

		// The css configs themselves are always linted too
		expect(result.totalFilesProcessed).toBe(4);
		expect(messagesFor(result, "apps/admin/src/page.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-brand`",
		);
		expect(messagesFor(result, "apps/web/src/page.html")).toContain(
			"The class `text-[var(--color-brand)]` can be written as `text-(--color-brand)`",
		);
	});
});
