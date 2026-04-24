import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "@tailwindcss/language-service";
import {
	loadWorkspaceTailwindSettings,
	mergeEditorSettings,
} from "../src/utils/settings";

describe("workspace tailwind settings", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-settings-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should load Tailwind settings from .zed/settings.json", () => {
		fs.mkdirSync(path.join(tmpDir, ".zed"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".zed", "settings.json"),
			`{
				"lsp": {
					"tailwindcss-language-server": {
						"settings": {
							"classFunctions": ["cx", "cva"],
							"experimental": {
								"classRegex": [["tw=\\"([^\\"]*)\\"", "([^\\"]*)"]]
							},
							"lint": {
								"invalidApply": "warning"
							}
						}
					}
				}
			}`,
			"utf-8",
		);

		expect(loadWorkspaceTailwindSettings(tmpDir)).toEqual({
			classFunctions: ["cx", "cva"],
			experimental: {
				classRegex: [['tw="([^"]*)"', '([^"]*)']],
			},
			lint: {
				invalidApply: "warning",
			},
		});
	});

	it("should load Tailwind settings from .vscode/settings.json", () => {
		fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".vscode", "settings.json"),
			`{
				// VS Code style settings
				"tailwindCSS.classFunctions": ["cn"],
				"tailwindCSS.experimental": {
					"classRegex": ["tw=\\"([^\\"]*)\\""]
				},
				"tailwindCSS.files": {
					"exclude": ["**/vendor/**"]
				}
			}`,
			"utf-8",
		);

		expect(loadWorkspaceTailwindSettings(tmpDir)).toEqual({
			classFunctions: ["cn"],
			experimental: {
				classRegex: ['tw="([^"]*)"'],
			},
			files: {
				exclude: ["**/vendor/**"],
			},
		});
	});

	it("should merge VS Code and Zed settings with Zed taking precedence", () => {
		fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, ".zed"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".vscode", "settings.json"),
			`{
				"tailwindCSS.classFunctions": ["cn"],
				"tailwindCSS.lint": {
					"invalidApply": "warning"
				}
			}`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(tmpDir, ".zed", "settings.json"),
			`{
				"lsp": {
					"tailwindcss-language-server": {
						"settings": {
							"classFunctions": ["cx"],
							"lint": {
								"invalidApply": "error",
								"invalidVariant": "warning"
							}
						}
					}
				}
			}`,
			"utf-8",
		);

		expect(loadWorkspaceTailwindSettings(tmpDir)).toEqual({
			classFunctions: ["cn", "cx"],
			experimental: {
				classRegex: undefined,
			},
			lint: {
				invalidApply: "error",
				invalidVariant: "warning",
			},
		});
	});

	it("should merge workspace settings into editor defaults", () => {
		const defaults: Settings = {
			editor: { tabSize: 2 },
			tailwindCSS: {
				inspectPort: null,
				emmetCompletions: false,
				includeLanguages: {},
				classAttributes: ["class", "className"],
				classFunctions: [],
				suggestions: true,
				hovers: true,
				codeLens: false,
				codeActions: true,
				validate: true,
				showPixelEquivalents: true,
				rootFontSize: 16,
				colorDecorators: true,
				lint: {
					cssConflict: "warning",
					invalidApply: "error",
					invalidScreen: "error",
					invalidVariant: "error",
					invalidConfigPath: "error",
					invalidTailwindDirective: "error",
					invalidSourceDirective: "error",
					recommendedVariantOrder: "warning",
					usedBlocklistedClass: "warning",
					suggestCanonicalClasses: "warning",
				},
				experimental: {
					classRegex: ["default-regex"],
					configFile: null,
				},
				files: {
					exclude: ["**/node_modules/**"],
				},
			},
		};

		const merged = mergeEditorSettings(defaults, {
			classFunctions: ["cx"],
			experimental: {
				classRegex: ["custom-regex"],
			},
			files: {
				exclude: ["**/vendor/**"],
			},
		});

		expect(merged.tailwindCSS.classFunctions).toEqual(["cx"]);
		expect(merged.tailwindCSS.experimental.classRegex).toEqual([
			"default-regex",
			"custom-regex",
		]);
		expect(merged.tailwindCSS.files.exclude).toEqual([
			"**/node_modules/**",
			"**/vendor/**",
		]);
	});
});
