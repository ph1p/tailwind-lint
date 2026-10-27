import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { State } from "@tailwindcss/language-service";
import ansis from "ansis";
import postcss from "postcss";
import { SYNTHETIC_VITE_CSS_CONFIG_CONTENT } from "../constants";
import type { DesignSystem } from "../types";
import { AdapterLoadError } from "../types";
import type { TailwindConfigTarget } from "../utils/config";
import { fileExists, readFileSync } from "../utils/fs";

const require = createRequire(import.meta.url || __filename);

function resolveModule(id: string, paths: string[]): string {
	let firstError: unknown;
	for (const dir of paths) {
		try {
			// createRequire per directory honors package "exports" subpaths
			return createRequire(path.join(dir, "noop.js")).resolve(id);
		} catch (error) {
			firstError ??= error;
		}
	}
	throw firstError ?? new Error(`Cannot find module "${id}"`);
}

// ESM-only plugins come back from require() as a module namespace instead
// of the plugin itself, so import and unwrap the default export.
async function importModule(modulePath: string): Promise<unknown> {
	let mod: unknown;
	try {
		mod = await import(pathToFileURL(modulePath).href);
	} catch {
		mod = require(modulePath);
	}
	if (mod !== null && typeof mod === "object" && "default" in mod) {
		return mod.default;
	}
	return mod;
}

function fromPostcss(nodes: postcss.ChildNode[]): unknown[] {
	return nodes.map((node) => {
		switch (node.type) {
			case "rule":
				return {
					kind: "rule",
					selector: node.selector,
					nodes: fromPostcss(node.nodes),
				};
			case "atrule":
				return {
					kind: "at-rule",
					name: node.name,
					params: node.params,
					nodes: node.nodes ? fromPostcss(node.nodes) : null,
				};
			case "decl":
				return {
					kind: "declaration",
					property: node.prop,
					value: node.value,
					important: node.important,
				};
			default:
				return { kind: "comment", value: node.text };
		}
	});
}

type CanonicalizeFn = (candidates: string[], options?: unknown) => string[];

// Note: getVariantOrder must not be cached, it grows as new variants are parsed
function memoizeCanonicalize(designSystem: DesignSystem) {
	const canonicalize = designSystem.canonicalizeCandidates;
	if (typeof canonicalize === "function") {
		const cache = new Map<string, string[]>();
		designSystem.canonicalizeCandidates = ((candidates, options) => {
			const key = `${JSON.stringify(options ?? null)}\0${candidates.join(" ")}`;
			let result = cache.get(key);
			if (!result) {
				result = (canonicalize as CanonicalizeFn).call(
					designSystem,
					candidates,
					options,
				);
				cache.set(key, result);
			}
			return [...result];
		}) satisfies CanonicalizeFn;
	}
}

export async function loadV4DesignSystem(
	state: State,
	resolvePaths: string[],
	target: TailwindConfigTarget,
	verbose = false,
): Promise<void> {
	try {
		const tailwindPath = require.resolve("tailwindcss", {
			paths: resolvePaths,
		});
		const tailwindcss = require(tailwindPath) as unknown;

		if (
			tailwindcss !== null &&
			tailwindcss !== undefined &&
			(typeof tailwindcss === "object" || typeof tailwindcss === "function") &&
			"__unstable__loadDesignSystem" in tailwindcss &&
			typeof tailwindcss.__unstable__loadDesignSystem === "function"
		) {
			const cssContent =
				target.kind === "vite"
					? SYNTHETIC_VITE_CSS_CONFIG_CONTENT
					: readFileSync(target.path);

			type LoadDesignSystemFn = (
				css: string,
				options: {
					base: string;
					loadModule?: (
						id: string,
						base: string,
						type: "config" | "plugin",
					) => Promise<{ base: string; module: unknown }>;
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
				base: path.dirname(target.path),
				async loadModule(
					id: string,
					base: string,
					_type: "config" | "plugin",
				): Promise<{ base: string; module: unknown }> {
					try {
						const modulePath = resolveModule(id, [base, ...resolvePaths]);
						return {
							base: path.dirname(modulePath),
							module: await importModule(modulePath),
						};
					} catch (error) {
						throw new Error(
							`Failed to load module "${id}": ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				},
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
								paths: [base, ...resolvePaths],
							});
							const pkgDir = path.dirname(pkgJsonPath);
							const cssPath = path.join(pkgDir, "index.css");
							if (fileExists(cssPath)) {
								return {
									base: pkgDir,
									content: readFileSync(cssPath),
								};
							}
						} catch {
							// Package not found or doesn't have index.css - continue to file path resolution
						}
					}

					const filePath = path.resolve(base, _id);
					if (fileExists(filePath)) {
						return {
							base: path.dirname(filePath),
							content: readFileSync(filePath),
						};
					}

					return { base, content: "" };
				},
			});

			const compileUncached = (classes: string[]): unknown[][] => {
				if (designSystem.candidatesToAst) {
					return designSystem.candidatesToAst(classes);
				}

				if (designSystem.candidatesToCss) {
					return designSystem.candidatesToCss(classes).map((css) => {
						if (!css) return [];
						try {
							return fromPostcss(postcss.parse(css).nodes);
						} catch {
							return [];
						}
					});
				}

				return classes.map(() => []);
			};

			memoizeCanonicalize(designSystem);

			// The language service compiles every class list of every file, and
			// each compile re-sorts all variants. The design system is fixed
			// after loading, so per-class results can be shared across files.
			const compileCache = new Map<string, unknown[]>();
			Object.assign(designSystem, {
				dependencies: () => new Set<string>(),
				compile(classes: string[]): unknown[][] {
					const missing = [
						...new Set(classes.filter((c) => !compileCache.has(c))),
					];
					if (missing.length > 0) {
						const compiled = compileUncached(missing);
						for (const [index, className] of missing.entries()) {
							compileCache.set(className, compiled[index] ?? []);
						}
					}
					return classes.map((c) => compileCache.get(c) ?? []);
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
				console.log(ansis.dim("  ✓ Loaded v4 design system"));
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
