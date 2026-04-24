#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import ansis from "ansis";
import { Command } from "commander";
import {
	DEFAULT_FILE_PATTERN,
	DEFAULT_VERSION,
	SEVERITY,
	TERMINAL_PADDING,
	TERMINAL_WIDTH,
} from "./constants";
import { lint } from "./linter";
import {
	countBySeverity,
	createJsonErrorOutput,
	createJsonOutput,
} from "./output";
import type { LintFileResult } from "./types";

const MAX_FILENAME_DISPLAY_LENGTH = 50;

interface CliOptions {
	config?: string;
	auto?: boolean;
	fix?: boolean;
	verbose?: boolean;
	format?: "text" | "json";
}

function resolveOptions(files: string[], options: CliOptions) {
	const hasConfigFlag = !!options.config;
	const hasAutoFlag = !!options.auto;
	const hasFiles = files.length > 0;

	let cwd = process.cwd();
	let configPath = options.config;
	let patterns = files;
	let autoDiscover = hasAutoFlag;

	if (hasConfigFlag && options.config) {
		configPath = path.isAbsolute(options.config)
			? options.config
			: path.resolve(process.cwd(), options.config);
	}

	if (hasConfigFlag && options.config && !hasFiles) {
		cwd = path.dirname(configPath);
		patterns = [];
		autoDiscover = true;
	}

	return {
		cwd,
		configPath,
		patterns: autoDiscover ? [] : patterns,
		autoDiscover,
		fix: options.fix || false,
		verbose: options.verbose || false,
	};
}

function truncateFilename(filename: string) {
	return filename.length > MAX_FILENAME_DISPLAY_LENGTH
		? `...${filename.slice(-MAX_FILENAME_DISPLAY_LENGTH)}`
		: filename;
}

async function displayResults(files: LintFileResult[], fixMode: boolean) {
	let totalErrors = 0;
	let totalWarnings = 0;
	let totalFixed = 0;
	let filesWithIssues = 0;
	let isFirstFile = true;

	for (const file of files) {
		if (file.diagnostics.length > 0 || (fixMode && file.fixed)) {
			if (isFirstFile) {
				console.log();
				isFirstFile = false;
			} else {
				console.log();
			}
			console.log(ansis.underline.bold(file.path));

			if (fixMode && file.fixed) {
				const issueText = `${file.fixedCount || 0} issue${file.fixedCount !== 1 ? "s" : ""}`;
				console.log(ansis.green(`  ✔ Fixed ${issueText}`));
				totalFixed += file.fixedCount || 0;
			}

			const { errors, warnings } = countBySeverity(file.diagnostics);
			totalErrors += errors;
			totalWarnings += warnings;

			if (file.diagnostics.length > 0) {
				filesWithIssues++;
			}

			for (const diagnostic of file.diagnostics) {
				const line = diagnostic.range.start.line + 1;
				const char = diagnostic.range.start.character + 1;
				const severity =
					diagnostic.severity === SEVERITY.ERROR ? "error" : "warning";
				const severityColor =
					diagnostic.severity === SEVERITY.ERROR
						? ansis.red(severity)
						: ansis.yellow(severity);
				const code = diagnostic.code ? ansis.dim(`  (${diagnostic.code})`) : "";

				console.log(
					`  ${ansis.dim(`${line}:${char}`)}  ${severityColor}  ${diagnostic.message}${code}`,
				);
			}
		}
	}

	console.log();

	if (totalErrors === 0 && totalWarnings === 0) {
		if (totalFixed > 0) {
			const issueText = `${totalFixed} issue${totalFixed !== 1 ? "s" : ""}`;
			console.log(ansis.green.bold(`✔ Fixed ${issueText}`));
		} else {
			console.log(ansis.green.bold("✔ No issues found"));
		}
	} else {
		const parts = [];
		if (totalErrors > 0) {
			parts.push(`${totalErrors} error${totalErrors !== 1 ? "s" : ""}`);
		}
		if (totalWarnings > 0) {
			parts.push(`${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}`);
		}

		const fileText = `${filesWithIssues} file${filesWithIssues !== 1 ? "s" : ""}`;
		const summary = `Found ${parts.join(" and ")} in ${fileText}`;

		if (totalFixed > 0) {
			const issueText = `${totalFixed} issue${totalFixed !== 1 ? "s" : ""}`;
			console.log(ansis.green.bold(`✔ Fixed ${issueText}`));
			console.log(summary);
		} else {
			console.log(summary);
		}
	}
}

const program = new Command();

const getVersion = (): string => {
	const packageJsonPath = path.join(__dirname, "../package.json");
	try {
		const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
		return pkg.version || DEFAULT_VERSION;
	} catch {
		return DEFAULT_VERSION;
	}
};

program.configureHelp({
	formatHelp: (cmd, helper) => {
		const termWidth = helper.padWidth(cmd, helper);
		let output = "";

		output += `${ansis.bold.cyan("Usage:")} ${helper.commandUsage(cmd)}\n\n`;

		if (cmd.description()) {
			output += `${cmd.description()}\n\n`;
		}

		const args = helper.visibleArguments(cmd);
		if (args.length > 0) {
			output += `${ansis.bold.cyan("Arguments:")}\n`;
			args.forEach((arg) => {
				const argName = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
				output += `  ${ansis.green(argName.padEnd(termWidth))} ${arg.description}\n`;
			});
			output += "\n";
		}

		const options = helper.visibleOptions(cmd);
		if (options.length > 0) {
			output += `${ansis.bold.cyan("Options:")}\n`;
			options.forEach((option) => {
				const flags = helper.optionTerm(option);
				const description = helper.optionDescription(option);
				output += `  ${ansis.yellow(flags.padEnd(termWidth))} ${description}\n`;
			});
			output += "\n";
		}

		return output;
	},
});

program
	.name("tailwind-lint")
	.description("A CLI tool for linting Tailwind CSS class usage")
	.version(getVersion())
	.argument(
		"[files...]",
		'File patterns to lint (e.g., "src/**/*.{js,jsx,ts,tsx}")',
	)
	.option(
		"-c, --config <path>",
		"Path to Tailwind config file (default: auto-discover)",
	)
	.option(
		"-a, --auto",
		"Auto-discover files from Tailwind config or CSS @source patterns",
	)
	.option("--fix", "Automatically fix problems that can be fixed")
	.option("-v, --verbose", "Enable verbose logging for debugging")
	.option("--format <format>", "Output format: text or json", "text")
	.addHelpText(
		"after",
		`
${ansis.bold.cyan("Examples:")}
  ${ansis.dim("$")} tailwind-lint
  ${ansis.dim("$")} tailwind-lint ${ansis.green('"src/**/*.{js,jsx,ts,tsx}"')}
  ${ansis.dim("$")} tailwind-lint ${ansis.yellow("--config")} ${ansis.green("./tailwind.config.js")}
  ${ansis.dim("$")} tailwind-lint ${ansis.yellow("--config")} ${ansis.green("./src/app.css")}
  ${ansis.dim("$")} tailwind-lint ${ansis.green('"src/**/*.tsx"')} ${ansis.yellow("--fix")}
  ${ansis.dim("$")} tailwind-lint ${ansis.green('"**/*.vue"')}

${ansis.bold.cyan("Notes:")}
  ${ansis.dim("•")} Running without arguments auto-discovers config and files
  ${ansis.dim("•")} Using ${ansis.yellow("--config")} without files scans based on that config
  ${ansis.dim("•")} For v3: uses content patterns from tailwind.config.js
  ${ansis.dim("•")} For v4: uses @source patterns from CSS config, Vite detection, or default pattern
  ${ansis.dim("•")} Default pattern: ${ansis.dim(DEFAULT_FILE_PATTERN)}
  ${ansis.dim("•")} Reads Tailwind workspace settings from ${ansis.dim(".zed/settings.json")} and ${ansis.dim(".vscode/settings.json")}
  ${ansis.dim("•")} Use ${ansis.yellow("--fix")} to automatically resolve fixable issues
`,
	)
	.action(async (files: string[], options) => {
		const hasConfigFlag = !!options.config;
		const hasAutoFlag = !!options.auto;
		const hasFiles = files.length > 0;

		// If no arguments provided, enable auto mode by default
		if (!hasFiles && !hasAutoFlag && !hasConfigFlag) {
			options.auto = true;
		}

		const resolved = resolveOptions(files, options);
		const format = options.format === "json" ? "json" : "text";
		const isJsonOutput = format === "json";

		try {
			if (resolved.verbose && !isJsonOutput) {
				console.log(ansis.cyan.bold("→ Configuration"));
				console.log(ansis.dim(`  Working directory: ${resolved.cwd}`));
				console.log(
					ansis.dim(`  Config path: ${resolved.configPath || "auto-discover"}`),
				);
				console.log(ansis.dim(`  Fix mode: ${resolved.fix}`));
				console.log(
					ansis.dim(
						`  Patterns: ${resolved.patterns.length > 0 ? resolved.patterns.join(", ") : "auto-discover"}`,
					),
				);
				console.log();
			}

			const results = await lint({
				...resolved,
				onProgress: (current, total, file) => {
					if (isJsonOutput) return;

					if (process.stdout.isTTY && !resolved.verbose) {
						const displayFile = truncateFilename(file);
						process.stdout.write(
							`\r${ansis.cyan("→")} Linting files... ${ansis.dim(`(${current}/${total})`)} ${ansis.dim(displayFile)}${" ".repeat(TERMINAL_PADDING)}`,
						);
					} else if (resolved.verbose) {
						console.log(ansis.dim(`  [${current}/${total}] Linting ${file}`));
					}
				},
			});

			if (process.stdout.isTTY && !resolved.verbose && !isJsonOutput) {
				process.stdout.write(`\r${" ".repeat(TERMINAL_WIDTH)}\r`);
			}

			if (results.totalFilesProcessed === 0) {
				if (isJsonOutput) {
					console.log(
						JSON.stringify(
							createJsonOutput({
								...resolved,
								files: [],
								totalFilesProcessed: 0,
							}),
						),
					);
				} else {
					console.log();
					console.log(ansis.yellow("⚠ No files found to lint"));
				}
				process.exit(0);
			}

			if (results.files.length === 0) {
				if (isJsonOutput) {
					console.log(
						JSON.stringify(
							createJsonOutput({
								...resolved,
								files: [],
								totalFilesProcessed: results.totalFilesProcessed,
							}),
						),
					);
				} else {
					console.log(ansis.green.bold("✔ No issues found"));
				}
				process.exit(0);
			}

			if (isJsonOutput) {
				console.log(
					JSON.stringify(
						createJsonOutput({
							...resolved,
							files: results.files,
							totalFilesProcessed: results.totalFilesProcessed,
						}),
					),
				);
			} else {
				await displayResults(results.files, resolved.fix);
			}

			const hasErrors = results.files.some((file) =>
				file.diagnostics.some((d) => d.severity === SEVERITY.ERROR),
			);
			process.exit(hasErrors ? 1 : 0);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			if (isJsonOutput) {
				console.log(
					JSON.stringify(
						createJsonErrorOutput({
							error: errorMessage,
							...resolved,
						}),
					),
				);
			} else {
				console.error(ansis.red("✖ Error:"), errorMessage);
			}

			if (resolved.verbose && error instanceof Error && !isJsonOutput) {
				console.error(ansis.dim("\nStack trace:"));
				console.error(ansis.dim(error.stack || error.toString()));
			}
			process.exit(1);
		}
	});

program.parse();
