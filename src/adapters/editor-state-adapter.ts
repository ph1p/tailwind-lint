import * as fs from "node:fs";
import * as path from "node:path";
import type { EditorState, Settings } from "@tailwindcss/language-service";
import { DEFAULT_ROOT_FONT_SIZE, DEFAULT_TAB_SIZE } from "../constants";

function isDirectory(filePath: string) {
	try {
		return fs.statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}

export function createEditorState(cwd: string) {
	const settings: Settings = {
		editor: {
			tabSize: DEFAULT_TAB_SIZE,
		},
		tailwindCSS: {
			inspectPort: null,
			emmetCompletions: false,
			includeLanguages: {},
			classAttributes: [
				"class",
				"className",
				"ngClass",
				"[class]",
				":class",
				"v-bind:class",
				"x-bind:class",
				"class:list",
				"classList",
			],
			classFunctions: [],
			codeActions: true,
			hovers: true,
			codeLens: false,
			suggestions: true,
			validate: true,
			colorDecorators: true,
			rootFontSize: DEFAULT_ROOT_FONT_SIZE,
			showPixelEquivalents: true,
			files: {
				exclude: [
					"**/.git/**",
					"**/node_modules/**",
					"**/.hg/**",
					"**/.svn/**",
				],
			},
			experimental: {
				configFile: null,
				classRegex: [],
			},
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
		},
	};

	return {
		connection: null as unknown as EditorState["connection"],
		folder: cwd,
		userLanguages: {},
		capabilities: {
			configuration: true,
			diagnosticRelatedInformation: true,
			itemDefaults: [],
		},
		getConfiguration: async () => settings,
		getDocumentSymbols: async () => [],
		readDirectory: async (document, directory) => {
			const docPath =
				typeof document === "string"
					? document
					: document.uri.replace("file://", "");
			const dir = path.resolve(path.dirname(docPath), directory);
			try {
				const files = fs.readdirSync(dir);
				return files.map((file): [string, { isDirectory: boolean }] => [
					file,
					{ isDirectory: isDirectory(path.join(dir, file)) },
				]);
			} catch {
				return [];
			}
		},
	};
}
