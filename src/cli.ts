#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import ansis from "ansis";
import { Command, InvalidArgumentError } from "commander";
import { DEFAULT_FILE_PATTERN, DEFAULT_VERSION, SEVERITY } from "./constants";
import { diffLines } from "./diff";
import { lint } from "./linter";
import {
	countBySeverity,
	countFixable,
	createJsonErrorOutput,
	createJsonOutput,
} from "./output";
import type { LintFileResult } from "./types";
import { findProjectRoot, isCssConfigFile } from "./utils/config";

const MAX_FILENAME_DISPLAY_LENGTH = 50;
const MAX_DIFF_LINES_PER_FILE = 10;
const CLEAR_LINE = "\r\x1b[2K";

interface CliOptions {
	config?: string;
	auto?: boolean;
	fix?: boolean;
	dryRun?: boolean;
	verbose?: boolean;
	format?: "text" | "json";
	rootFontSize?: number;
}

function resolveOptions(files: string[], options: CliOptions) {
	const hasAutoFlag = !!options.auto;
	const hasFiles = files.length > 0;

	let cwd = process.cwd();
	const configPath = options.config && path.resolve(options.config);
	let patterns = files;
	let autoDiscover = hasAutoFlag;

	if (configPath && !hasFiles) {
		const configDir = path.dirname(configPath);
		cwd = isCssConfigFile(configPath) ? findProjectRoot(configDir) : configDir;
		patterns = [];
		autoDiscover = true;
	}

	const dryRun = options.dryRun || false;

	return {
		cwd,
		configPath,
		patterns: autoDiscover ? [] : patterns,
		autoDiscover,
		fix: options.fix || dryRun,
		dryRun,
		verbose: options.verbose || false,
		rootFontSize: options.rootFontSize,
	};
}

function truncateFilename(filename: string) {
	return filename.length > MAX_FILENAME_DISPLAY_LENGTH
		? `...${filename.slice(-MAX_FILENAME_DISPLAY_LENGTH)}`
		: filename;
}

function plural(count: number, word: string) {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatDuration(ms: number) {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatDiff(file: LintFileResult) {
	if (file.originalContent === undefined || file.fixedContent === undefined) {
		return [];
	}

	const changes = diffLines(file.originalContent, file.fixedContent);
	const shown = changes.slice(0, MAX_DIFF_LINES_PER_FILE);
	const width = String(shown.at(-1)?.line ?? 0).length;
	const lines: string[] = [];

	for (const change of shown) {
		const lineNo = ansis.dim(String(change.line).padStart(width));
		const blank = " ".repeat(width);
		if (change.removed !== undefined) {
			lines.push(`    ${lineNo} ${ansis.red(`- ${change.removed.trim()}`)}`);
		}
		if (change.added !== undefined) {
			const prefix = change.removed !== undefined ? blank : lineNo;
			lines.push(`    ${prefix} ${ansis.green(`+ ${change.added.trim()}`)}`);
		}
	}

	const hidden = changes.length - shown.length;
	if (hidden > 0) {
		lines.push(ansis.dim(`    … ${plural(hidden, "more changed line")}`));
	}
	return lines;
}

function formatFile(file: LintFileResult, dryRun: boolean) {
	const lines = [ansis.underline.bold(file.path)];

	if (file.fixed) {
		const issues = plural(file.fixedCount || 0, "issue");
		lines.push(
			dryRun
				? ansis.cyan(`  ~ Would fix ${issues}`)
				: ansis.green(`  ✔ Fixed ${issues}`),
		);
		if (dryRun) lines.push(...formatDiff(file));
	}

	const positions = file.diagnostics.map(
		(d) => `${d.range.start.line + 1}:${d.range.start.character + 1}`,
	);
	const positionWidth = Math.max(0, ...positions.map((p) => p.length));

	for (const [index, diagnostic] of file.diagnostics.entries()) {
		const isError = diagnostic.severity === SEVERITY.ERROR;
		const severity = isError ? ansis.red("error  ") : ansis.yellow("warning");
		const code = diagnostic.code
			? `  ${ansis.dim(String(diagnostic.code))}`
			: "";
		lines.push(
			`  ${ansis.dim(positions[index].padEnd(positionWidth))}  ${severity}  ${diagnostic.message}${code}`,
		);
	}

	return lines;
}

function formatSummary(
	files: LintFileResult[],
	totalFilesProcessed: number,
	durationMs: number,
	fixMode: boolean,
	dryRun: boolean,
) {
	let errors = 0;
	let warnings = 0;
	let fixed = 0;
	let fixable = 0;
	let filesWithIssues = 0;
	let filesFixed = 0;

	for (const file of files) {
		const counts = countBySeverity(file.diagnostics);
		errors += counts.errors;
		warnings += counts.warnings;
		fixable += countFixable(file.diagnostics);
		if (file.diagnostics.length > 0) filesWithIssues++;
		if (file.fixed) {
			fixed += file.fixedCount || 0;
			filesFixed++;
		}
	}

	const lines: string[] = [];

	if (fixed > 0) {
		const text = `${plural(fixed, "issue")} in ${plural(filesFixed, "file")}`;
		lines.push(
			dryRun
				? ansis.cyan.bold(`~ Would fix ${text} (dry run, no files written)`)
				: ansis.green.bold(`✔ Fixed ${text}`),
		);
	}

	const problems = errors + warnings;
	if (problems === 0) {
		if (fixed === 0) lines.push(ansis.green.bold("✔ No issues found"));
	} else {
		const color = errors > 0 ? ansis.red.bold : ansis.yellow.bold;
		lines.push(
			color(
				`✖ ${plural(problems, "problem")} (${plural(errors, "error")}, ${plural(warnings, "warning")}) in ${plural(filesWithIssues, "file")}`,
			),
		);
		if (fixable > 0 && !fixMode) {
			lines.push(
				ansis.dim(
					`  ${fixable} potentially fixable with ${ansis.yellow("--fix")} (preview with ${ansis.yellow("--dry-run")})`,
				),
			);
		}
	}

	lines.push(
		ansis.dim(
			`Linted ${plural(totalFilesProcessed, "file")} in ${formatDuration(durationMs)}`,
		),
	);
	return lines;
}

// Exiting right after a large write can truncate piped stdout (async on
// macOS), so wait for the write to flush before exiting.
function writeAndExit(output: string, code: number) {
	process.stdout.write(output, () => process.exit(code));
}

function parseRootFontSize(value: string) {
	const size = Number(value);
	if (!(size > 0)) {
		throw new InvalidArgumentError("Must be a positive number.");
	}
	return size;
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
	.option(
		"--dry-run",
		"Show which fixes --fix would apply without writing any files",
	)
	.option(
		"--root-font-size <px>",
		"Root font size in px for rem conversions (default: auto-detect, else 16)",
		parseRootFontSize,
	)
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
  ${ansis.dim("$")} tailwind-lint ${ansis.yellow("--dry-run")}
  ${ansis.dim("$")} tailwind-lint ${ansis.green('"**/*.vue"')}

${ansis.bold.cyan("Notes:")}
  ${ansis.dim("•")} Running without arguments auto-discovers config and files
  ${ansis.dim("•")} Using ${ansis.yellow("--config")} without files scans based on that config
  ${ansis.dim("•")} For v3: uses content patterns from tailwind.config.js
  ${ansis.dim("•")} For v4: uses @source patterns from CSS config, Vite detection, or default pattern
  ${ansis.dim("•")} Default pattern: ${ansis.dim(DEFAULT_FILE_PATTERN)}
  ${ansis.dim("•")} Reads Tailwind workspace settings from ${ansis.dim(".zed/settings.json")} and ${ansis.dim(".vscode/settings.json")}
  ${ansis.dim("•")} Use ${ansis.yellow("--fix")} to automatically resolve fixable issues
  ${ansis.dim("•")} Use ${ansis.yellow("--dry-run")} to preview fixes without changing files
  ${ansis.dim("•")} Root font size: ${ansis.yellow("--root-font-size")}, else editor settings, else detected from ${ansis.dim("<html>")} or CSS
`,
	)
	.action(async (files: string[], options: CliOptions) => {
		const hasConfigFlag = !!options.config;
		const hasAutoFlag = !!options.auto;
		const hasFiles = files.length > 0;

		// If no arguments provided, enable auto mode by default
		if (!hasFiles && !hasAutoFlag && !hasConfigFlag) {
			options.auto = true;
		}

		const resolved = resolveOptions(files, options);
		const isJsonOutput = options.format === "json";
		const showProgress =
			!isJsonOutput && !resolved.verbose && !!process.stdout.isTTY;
		const startTime = performance.now();

		try {
			if (resolved.verbose && !isJsonOutput) {
				console.log(ansis.cyan.bold("→ Configuration"));
				console.log(ansis.dim(`  Working directory: ${resolved.cwd}`));
				console.log(
					ansis.dim(`  Config path: ${resolved.configPath || "auto-discover"}`),
				);
				console.log(ansis.dim(`  Fix mode: ${resolved.fix}`));
				console.log(ansis.dim(`  Dry run: ${resolved.dryRun}`));
				console.log(
					ansis.dim(
						`  Patterns: ${resolved.patterns.length > 0 ? resolved.patterns.join(", ") : "auto-discover"}`,
					),
				);
				console.log();
			}

			if (showProgress) {
				process.stdout.write(
					`${ansis.cyan("→")} Loading Tailwind configuration...`,
				);
			}

			const results = await lint({
				...resolved,
				onProgress: (current, total, file) => {
					if (showProgress) {
						process.stdout.write(
							`${CLEAR_LINE}${ansis.cyan("→")} Linting files... ${ansis.dim(`(${current}/${total})`)} ${ansis.dim(truncateFilename(file))}`,
						);
					} else if (resolved.verbose && !isJsonOutput) {
						console.log(ansis.dim(`  [${current}/${total}] Linting ${file}`));
					}
				},
			});

			if (showProgress) {
				process.stdout.write(CLEAR_LINE);
			}

			const hasErrors = results.files.some((file) =>
				file.diagnostics.some((d) => d.severity === SEVERITY.ERROR),
			);
			const exitCode = hasErrors ? 1 : 0;

			if (isJsonOutput) {
				return writeAndExit(
					`${JSON.stringify(
						createJsonOutput({
							...resolved,
							files: results.files,
							totalFilesProcessed: results.totalFilesProcessed,
							skippedFiles: results.skippedFiles,
						}),
					)}\n`,
					exitCode,
				);
			}

			const lines: string[] = [];
			for (const skipped of results.skippedFiles) {
				lines.push(
					ansis.yellow(
						`⚠ Skipped ${truncateFilename(skipped)} (exceeds size limit)`,
					),
				);
			}

			if (results.totalFilesProcessed === 0) {
				lines.push(ansis.yellow("⚠ No files found to lint"));
				return writeAndExit(`${lines.join("\n")}\n`, 0);
			}

			for (const file of results.files) {
				lines.push("", ...formatFile(file, resolved.dryRun));
			}
			if (results.files.length > 0) lines.push("");

			lines.push(
				...formatSummary(
					results.files,
					results.totalFilesProcessed,
					performance.now() - startTime,
					resolved.fix,
					resolved.dryRun,
				),
			);

			return writeAndExit(`${lines.join("\n")}\n`, exitCode);
		} catch (error) {
			if (showProgress) {
				process.stdout.write(CLEAR_LINE);
			}

			const errorMessage =
				error instanceof Error ? error.message : String(error);
			if (isJsonOutput) {
				return writeAndExit(
					`${JSON.stringify(
						createJsonErrorOutput({
							error: errorMessage,
							...resolved,
						}),
					)}\n`,
					1,
				);
			}

			console.error(ansis.red("✖ Error:"), errorMessage);

			if (resolved.verbose && error instanceof Error) {
				console.error(ansis.dim("\nStack trace:"));
				console.error(ansis.dim(error.stack || error.toString()));
			}
			process.exit(1);
		}
	});

program.parse();
