import * as path from "node:path";
import type {
	Settings,
	TailwindCssSettings,
} from "@tailwindcss/language-service";
import { fileExists, readFileSync } from "./fs";

type TailwindSettingsPatch = Partial<TailwindCssSettings>;

export function loadWorkspaceTailwindSettings(
	cwd: string,
): TailwindSettingsPatch {
	const vscodeSettings = readVsCodeTailwindSettings(cwd);
	const zedSettings = readZedTailwindSettings(cwd);

	return mergeTailwindSettings(vscodeSettings, zedSettings);
}

function readVsCodeTailwindSettings(cwd: string): TailwindSettingsPatch {
	const settingsPath = path.join(cwd, ".vscode", "settings.json");
	const parsed = readJsoncFile(settingsPath);
	if (!parsed || typeof parsed !== "object") {
		return {};
	}

	const raw = parsed as Record<string, unknown>;
	const experimental = readNestedObject(raw, "tailwindCSS.experimental");
	const files = readNestedObject(raw, "tailwindCSS.files");
	const lint = readNestedObject(raw, "tailwindCSS.lint");

	return {
		includeLanguages: asRecord(raw["tailwindCSS.includeLanguages"]),
		classAttributes: asStringArray(raw["tailwindCSS.classAttributes"]),
		classFunctions: asStringArray(raw["tailwindCSS.classFunctions"]),
		experimental: {
			classRegex: asClassRegex(experimental?.classRegex),
			configFile: asConfigFile(experimental?.configFile),
		},
		files: {
			exclude: asStringArray(files?.exclude),
		},
		lint: asLintSettings(lint),
	};
}

function readZedTailwindSettings(cwd: string): TailwindSettingsPatch {
	const settingsPath = path.join(cwd, ".zed", "settings.json");
	const parsed = readJsoncFile(settingsPath);
	if (!parsed || typeof parsed !== "object") {
		return {};
	}

	const raw = parsed as Record<string, unknown>;
	const lsp = asRecord(raw.lsp);
	const server = asRecord(lsp?.["tailwindcss-language-server"]);
	const serverSettings = asRecord(server?.settings);
	const tailwindSettings = asRecord(serverSettings?.tailwindCSS);
	const normalized = tailwindSettings ?? serverSettings;

	if (!normalized) {
		return {};
	}

	return {
		includeLanguages: asRecord(normalized.includeLanguages),
		classAttributes: asStringArray(normalized.classAttributes),
		classFunctions: asStringArray(normalized.classFunctions),
		experimental: {
			classRegex: asClassRegex(asRecord(normalized.experimental)?.classRegex),
			configFile: asConfigFile(asRecord(normalized.experimental)?.configFile),
		},
		files: {
			exclude: asStringArray(asRecord(normalized.files)?.exclude),
		},
		lint: asLintSettings(asRecord(normalized.lint)),
	};
}

function readJsoncFile(filePath: string): unknown {
	if (!fileExists(filePath)) {
		return null;
	}

	try {
		return JSON.parse(stripJsonComments(readFileSync(filePath)));
	} catch {
		return null;
	}
}

function stripJsonComments(content: string) {
	return content
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/,\s*([}\]])/g, "$1");
}

function readNestedObject(
	input: Record<string, unknown>,
	key: string,
): Record<string, unknown> | null {
	return asRecord(input[key]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: undefined;
}

function asClassRegex(
	value: unknown,
): string[] | [string, string][] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	if (value.every((item) => typeof item === "string")) {
		return value;
	}

	if (
		value.every(
			(item) =>
				Array.isArray(item) &&
				item.length === 2 &&
				item.every((part) => typeof part === "string"),
		)
	) {
		return value as [string, string][];
	}

	return undefined;
}

function asConfigFile(
	value: unknown,
): string | Record<string, string | string[]> | null | undefined {
	if (typeof value === "string" || value === null) {
		return value;
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	const entries = Object.entries(record).filter(
		([, entry]) =>
			typeof entry === "string" ||
			(Array.isArray(entry) && entry.every((item) => typeof item === "string")),
	);

	return entries.length === Object.keys(record).length
		? (Object.fromEntries(entries) as Record<string, string | string[]>)
		: undefined;
}

function asLintSettings(
	value: Record<string, unknown> | null,
): Partial<TailwindCssSettings["lint"]> | undefined {
	if (!value) {
		return undefined;
	}

	const entries = Object.entries(value).filter(([, entry]) =>
		["ignore", "warning", "error"].includes(String(entry)),
	);

	return entries.length > 0
		? (Object.fromEntries(entries) as Partial<TailwindCssSettings["lint"]>)
		: undefined;
}

function mergeTailwindSettings(
	...patches: TailwindSettingsPatch[]
): TailwindSettingsPatch {
	return patches.reduce<TailwindSettingsPatch>((acc, patch) => {
		if (patch.includeLanguages) {
			acc.includeLanguages = {
				...acc.includeLanguages,
				...patch.includeLanguages,
			};
		}

		if (patch.classAttributes) {
			acc.classAttributes = uniqueStrings(
				acc.classAttributes,
				patch.classAttributes,
			);
		}

		if (patch.classFunctions) {
			acc.classFunctions = uniqueStrings(
				acc.classFunctions,
				patch.classFunctions,
			);
		}

		if (patch.experimental) {
			acc.experimental = {
				...acc.experimental,
				...patch.experimental,
				classRegex: mergeClassRegex(
					acc.experimental?.classRegex,
					patch.experimental.classRegex,
				),
			};
		}

		if (patch.files?.exclude) {
			acc.files = {
				exclude: uniqueStrings(acc.files?.exclude, patch.files.exclude),
			};
		}

		if (patch.lint) {
			acc.lint = {
				...acc.lint,
				...patch.lint,
			};
		}

		return acc;
	}, {});
}

function uniqueStrings(...arrays: (string[] | undefined)[]) {
	return [...new Set(arrays.flatMap((array) => array ?? []))];
}

function mergeClassRegex(
	current?: string[] | [string, string][],
	next?: string[] | [string, string][],
) {
	if (!next) {
		return current;
	}
	if (!current) {
		return next;
	}

	const serialized = new Set<string>();
	const merged: Array<string | [string, string]> = [];

	for (const item of [...current, ...next]) {
		const key = JSON.stringify(item);
		if (serialized.has(key)) continue;
		serialized.add(key);
		merged.push(item);
	}

	return merged as string[] | [string, string][];
}

export function mergeEditorSettings(
	defaultSettings: Settings,
	overrides: TailwindSettingsPatch,
): Settings {
	return {
		...defaultSettings,
		tailwindCSS: {
			...defaultSettings.tailwindCSS,
			...overrides,
			includeLanguages: {
				...defaultSettings.tailwindCSS.includeLanguages,
				...overrides.includeLanguages,
			},
			classAttributes: uniqueStrings(
				defaultSettings.tailwindCSS.classAttributes,
				overrides.classAttributes,
			),
			classFunctions: uniqueStrings(
				defaultSettings.tailwindCSS.classFunctions,
				overrides.classFunctions,
			),
			files: {
				exclude: uniqueStrings(
					defaultSettings.tailwindCSS.files.exclude,
					overrides.files?.exclude,
				),
			},
			experimental: {
				...defaultSettings.tailwindCSS.experimental,
				...overrides.experimental,
				classRegex:
					mergeClassRegex(
						defaultSettings.tailwindCSS.experimental.classRegex,
						overrides.experimental?.classRegex,
					) ?? defaultSettings.tailwindCSS.experimental.classRegex,
			},
			lint: {
				...defaultSettings.tailwindCSS.lint,
				...overrides.lint,
			},
		},
	};
}
