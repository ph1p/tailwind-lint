#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { DEFAULT_FILE_PATTERN, DEFAULT_VERSION } from "./constants";
import { lint } from "./linter";
import type { LintFileResult, SerializedDiagnostic } from "./types";

const MAX_FILENAME_DISPLAY_LENGTH = 50;

function countDiagnosticsBySeverity(diagnostics: SerializedDiagnostic[]): {
	errors: number;
	warnings: number;
} {
	let errors = 0;
	let warnings = 0;

	for (const diagnostic of diagnostics) {
		if (diagnostic.severity === 1) errors++;
		if (diagnostic.severity === 2) warnings++;
	}

	return { errors, warnings };
}

interface ResolvedOptions {
	cwd: string;
	configPath: string | undefined;
	patterns: string[];
	autoDiscover: boolean;
	fix: boolean;
	verbose: boolean;
}

interface CliOptions {
	config?: string;
	auto?: boolean;
	fix?: boolean;
	verbose?: boolean;
}

function resolveOptions(files: string[], options: CliOptions): ResolvedOptions {
	const hasConfigFlag = !!options.config;
	const hasAutoFlag = !!options.auto;
	const hasFiles = files.length > 0;

	let cwd = process.cwd();
	let configPath = options.config;
	let patterns = files;

	if (hasConfigFlag && options.config && !hasFiles) {
		const absoluteConfigPath = path.isAbsolute(options.config)
			? options.config
			: path.resolve(process.cwd(), options.config);
		cwd = path.dirname(absoluteConfigPath);
		configPath = path.basename(absoluteConfigPath);
		patterns = [DEFAULT_FILE_PATTERN];
	}

	const autoDiscover = hasAutoFlag;

	return {
		cwd,
		configPath,
		patterns: autoDiscover ? [] : patterns,
		autoDiscover,
		fix: options.fix || false,
		verbose: options.verbose || false,
	};
}

function truncateFilename(filename: string): string {
	return filename.length > MAX_FILENAME_DISPLAY_LENGTH
		? `...${filename.slice(-MAX_FILENAME_DISPLAY_LENGTH)}`
		: filename;
}

async function displayResults(
	files: LintFileResult[],
	fixMode: boolean,
): Promise<void> {
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
			console.log(chalk.underline.bold(file.path));

			if (fixMode && file.fixed) {
				const issueText = `${file.fixedCount || 0} issue${file.fixedCount !== 1 ? "s" : ""}`;
				console.log(chalk.green(`  ✔ Fixed ${issueText}`));
				if (file.maxIterationsReached && file.diagnostics.length > 0) {
					console.log(
						chalk.yellow(
							`  ⚠ Maximum fix iterations reached - some issues may require manual intervention`,
						),
					);
				}
				totalFixed += file.fixedCount || 0;
			}

			const { errors, warnings } = countDiagnosticsBySeverity(file.diagnostics);
			totalErrors += errors;
			totalWarnings += warnings;

			if (file.diagnostics.length > 0) {
				filesWithIssues++;
			}

			for (const diagnostic of file.diagnostics) {
				const line = diagnostic.range.start.line + 1;
				const char = diagnostic.range.start.character + 1;
				const severity = diagnostic.severity === 1 ? "error" : "warning";
				const severityColor =
					diagnostic.severity === 1
						? chalk.red(severity)
						: chalk.yellow(severity);
				const code = diagnostic.code ? chalk.dim(`  (${diagnostic.code})`) : "";

				console.log(
					`  ${chalk.dim(`${line}:${char}`)}  ${severityColor}  ${diagnostic.message}${code}`,
				);
			}
		}
	}

	console.log();

	if (totalErrors === 0 && totalWarnings === 0) {
		if (totalFixed > 0) {
			const issueText = `${totalFixed} issue${totalFixed !== 1 ? "s" : ""}`;
			console.log(chalk.green.bold(`✔ Fixed ${issueText}`));
		} else {
			console.log(chalk.green.bold("✔ No issues found"));
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
			console.log(chalk.green.bold(`✔ Fixed ${issueText}`));
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

		output += `${chalk.bold.cyan("Usage:")} ${helper.commandUsage(cmd)}\n\n`;

		if (cmd.description()) {
			output += `${cmd.description()}\n\n`;
		}

		const args = helper.visibleArguments(cmd);
		if (args.length > 0) {
			output += `${chalk.bold.cyan("Arguments:")}\n`;
			args.forEach((arg) => {
				const argName = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
				output += `  ${chalk.green(argName.padEnd(termWidth))} ${arg.description}\n`;
			});
			output += "\n";
		}

		const options = helper.visibleOptions(cmd);
		if (options.length > 0) {
			output += `${chalk.bold.cyan("Options:")}\n`;
			options.forEach((option) => {
				const flags = helper.optionTerm(option);
				const description = helper.optionDescription(option);
				output += `  ${chalk.yellow(flags.padEnd(termWidth))} ${description}\n`;
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
		"Auto-discover files from Tailwind config content patterns",
	)
	.option("--fix", "Automatically fix problems that can be fixed")
	.option("-v, --verbose", "Enable verbose logging for debugging")
	.addHelpText(
		"after",
		`
${chalk.bold.cyan("Examples:")}
  ${chalk.dim("$")} tailwind-lint ${chalk.green('"src/**/*.{js,jsx,ts,tsx}"')}
  ${chalk.dim("$")} tailwind-lint ${chalk.yellow("--auto")}
  ${chalk.dim("$")} tailwind-lint ${chalk.yellow("--config")} ${chalk.green("./tailwind.config.js")}
  ${chalk.dim("$")} tailwind-lint ${chalk.green('"src/**/*.tsx"')} ${chalk.yellow("--fix")}
  ${chalk.dim("$")} tailwind-lint ${chalk.green('"**/*.vue"')}

${chalk.bold.cyan("Notes:")}
  ${chalk.dim("•")} Use ${chalk.yellow("--auto")} to auto-discover files from your Tailwind config (v3 only)
  ${chalk.dim("•")} Use ${chalk.yellow("--config")} alone to lint common file types from that directory
  ${chalk.dim("•")} Default pattern: ${chalk.dim("./**/*.{js,jsx,ts,tsx,html}")}
  ${chalk.dim("•")} Use ${chalk.yellow("--fix")} to automatically resolve fixable issues
`,
	)
	.action(async (files: string[], options) => {
		const hasConfigFlag = !!options.config;
		const hasAutoFlag = !!options.auto;
		const hasFiles = files.length > 0;

		if (!hasFiles && !hasAutoFlag && !hasConfigFlag) {
			console.error(
				"Error: No files specified. Use glob patterns, --auto flag, or --config flag.\n",
			);
			program.help();
		}

		const resolved = resolveOptions(files, options);

		try {
			if (resolved.verbose) {
				console.log(chalk.cyan("→ Running in verbose mode"));
				console.log(chalk.dim(`  Working directory: ${resolved.cwd}`));
				console.log(
					chalk.dim(`  Config path: ${resolved.configPath || "auto-discover"}`),
				);
				console.log(chalk.dim(`  Fix mode: ${resolved.fix}`));
				console.log(
					chalk.dim(
						`  Patterns: ${resolved.patterns.length > 0 ? resolved.patterns.join(", ") : "auto-discover"}`,
					),
				);
			}

			console.log();

			const results = await lint({
				...resolved,
				onProgress: (current, total, file) => {
					if (process.stdout.isTTY && !resolved.verbose) {
						const displayFile = truncateFilename(file);
						process.stdout.write(
							`\rLinting files... (${current}/${total}) ${chalk.dim(displayFile)}${" ".repeat(10)}`,
						);
					} else if (resolved.verbose) {
						console.log(chalk.dim(`  [${current}/${total}] Linting ${file}`));
					}
				},
			});

			if (process.stdout.isTTY && !resolved.verbose) {
				process.stdout.write("\n");
			}

			if (results.totalFilesProcessed === 0) {
				console.log(chalk.yellow("No files found to lint."));
				process.exit(0);
			}

			if (results.files.length === 0) {
				console.log(chalk.green.bold("✔ No issues found"));
				process.exit(0);
			}

			await displayResults(results.files, resolved.fix);

			const hasErrors = results.files.some((file) =>
				file.diagnostics.some((d) => d.severity === 1),
			);
			process.exit(hasErrors ? 1 : 0);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(chalk.red("✖ Error:"), errorMessage);

			if (resolved.verbose && error instanceof Error) {
				console.error(chalk.dim("\nStack trace:"));
				console.error(chalk.dim(error.stack || error.toString()));
			}
			process.exit(1);
		}
	});

program.parse();
