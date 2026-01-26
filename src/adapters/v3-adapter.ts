import { createRequire } from "node:module";
import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import chalk from "chalk";
import type { ContextUtils, GenerateRulesModule } from "../types";
import { AdapterLoadError } from "../types";

const require = createRequire(import.meta.url || __filename);

export async function loadV3ClassMetadata(
	state: State,
	cwd: string,
	verbose = false,
): Promise<void> {
	try {
		const tailwindPath = require.resolve("tailwindcss", { paths: [cwd] });
		const tailwindcss = require(tailwindPath) as unknown;

		try {
			const tailwindDir = path.dirname(
				require.resolve("tailwindcss/package.json", { paths: [cwd] }),
			);

			const contextUtils = require(
				path.join(tailwindDir, "lib", "lib", "setupContextUtils"),
			) as ContextUtils;
			const generateRulesModule = require(
				path.join(tailwindDir, "lib", "lib", "generateRules"),
			) as GenerateRulesModule;

			state.modules = {
				tailwindcss: {
					version: state.version || "unknown",
					module: tailwindcss,
				},
				jit: {
					generateRules: {
						module:
							generateRulesModule.generateRules ||
							((_set: unknown, _context: unknown) => []),
					},
					createContext: {
						module: contextUtils.createContext,
					},
					expandApplyAtRules: {
						module: generateRulesModule.expandApplyAtRules,
					},
				},
			};

			if (verbose) {
				console.log(chalk.dim("  ✓ Loaded v3 JIT modules"));
			}
		} catch (jitError) {
			// JIT modules are optional - some v3 configs may not have them
			// Fall back to basic module loading without JIT support
			if (verbose) {
				const message =
					jitError instanceof Error ? jitError.message : String(jitError);
				console.log(
					chalk.yellow(
						`  ⚠ Warning: Could not load v3 JIT modules: ${message}`,
					),
				);
			}

			state.modules = {
				tailwindcss: {
					version: state.version || "unknown",
					module: tailwindcss,
				},
			};
		}

		extractConfigMetadata(state);
	} catch (error) {
		if (error instanceof Error) {
			throw new AdapterLoadError("v3", error);
		}
		throw new Error(`Failed to load v3 class metadata: ${String(error)}`);
	}
}

function extractConfigMetadata(state: State): void {
	const { config } = state;
	if (!config || typeof config !== "object") return;

	const theme = (config as Record<string, unknown>).theme as
		| Record<string, unknown>
		| undefined;
	state.screens = Object.keys(
		(theme?.screens as Record<string, unknown>) ?? {},
	);
	state.blocklist = (config.blocklist as string[] | undefined) ?? [];

	if (config.variants && typeof config.variants === "object") {
		state.variants = Object.keys(config.variants).map((name) => ({
			name,
			values: [],
			isArbitrary: false,
			hasDash: true,
			selectors: () => [],
		}));
	}

	if (config.corePlugins) {
		state.corePlugins = Array.isArray(config.corePlugins)
			? (config.corePlugins as string[])
			: Object.keys(config.corePlugins as Record<string, unknown>);
	}
}
