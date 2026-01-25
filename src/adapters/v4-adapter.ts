import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import type { DesignSystem } from "../types";
import { AdapterLoadError } from "../types";

const require = createRequire(import.meta.url || __filename);

function fileExists(filePath: string): boolean {
	try {
		return fs.existsSync(filePath);
	} catch {
		return false;
	}
}

function readFileSync(filePath: string): string {
	if (!filePath || typeof filePath !== "string") {
		throw new TypeError("File path must be a non-empty string");
	}
	return fs.readFileSync(filePath, "utf-8");
}

export async function loadV4DesignSystem(
	state: State,
	cwd: string,
	configPath: string,
	verbose = false,
): Promise<void> {
	try {
		const tailwindPath = require.resolve("tailwindcss", { paths: [cwd] });
		const tailwindcss = require(tailwindPath) as unknown;

		if (
			tailwindcss !== null &&
			tailwindcss !== undefined &&
			(typeof tailwindcss === "object" || typeof tailwindcss === "function") &&
			"__unstable__loadDesignSystem" in tailwindcss &&
			typeof tailwindcss.__unstable__loadDesignSystem === "function"
		) {
			let cssContent: string;
			const basePath = path.dirname(configPath);

			if (fileExists(configPath)) {
				cssContent = readFileSync(configPath, true);
			} else {
				cssContent = '@import "tailwindcss";';
			}

			type LoadDesignSystemFn = (
				css: string,
				options: {
					base: string;
					loadStylesheet: (
						id: string,
						base: string,
						content?: string,
					) => Promise<{ base: string; content: string }>;
				},
			) => Promise<DesignSystem>;

			const loadDesignSystem =
				tailwindcss.__unstable__loadDesignSystem as LoadDesignSystemFn;

			const designSystem = await loadDesignSystem(cssContent, {
				base: basePath,
				async loadStylesheet(
					_id: string,
					base: string,
					content?: string,
				): Promise<{ base: string; content: string }> {
					if (content) {
						return { base, content };
					}

					if (!_id.startsWith(".") && !_id.startsWith("/")) {
						try {
							const pkgJsonPath = require.resolve(`${_id}/package.json`, {
								paths: [base, cwd],
							});
							const pkgDir = path.dirname(pkgJsonPath);
							const cssPath = path.join(pkgDir, "index.css");
							if (fileExists(cssPath)) {
								return {
									base: pkgDir,
									content: readFileSync(cssPath, true),
								};
							}
						} catch {}
					}

					const filePath = path.resolve(base, _id);
					if (fileExists(filePath)) {
						return {
							base: path.dirname(filePath),
							content: readFileSync(filePath, true),
						};
					}

					return { base, content: "" };
				},
			});

			Object.assign(designSystem, {
				dependencies: () => new Set<string>(),

				compile(classes: string[]): unknown[][] {
					const results = designSystem.candidatesToAst
						? designSystem.candidatesToAst(classes)
						: designSystem.candidatesToCss?.(classes) || [];

					return results.map((result: unknown) => {
						if (Array.isArray(result)) {
							return result;
						}
						if (result === null) {
							return [];
						}
						return [];
					});
				},
			});

			// @ts-expect-error - DesignSystem types are loaded dynamically at runtime
			state.designSystem = designSystem;

			if (!state.classNames) {
				state.classNames = {
					context: {},
				} as unknown as typeof state.classNames;
			}

			if (verbose) {
				console.log("  ✓ Loaded v4 design system");
			}
		} else {
			const error = new Error(
				"Tailwind v4 __unstable__loadDesignSystem is not available. Please ensure you have Tailwind CSS v4 installed.",
			);
			throw new AdapterLoadError("v4", error);
		}
	} catch (error) {
		if (error instanceof AdapterLoadError) {
			throw error;
		}
		if (error instanceof Error) {
			throw new AdapterLoadError("v4", error);
		}
		throw new Error(`Failed to load v4 design system: ${String(error)}`);
	}
}
