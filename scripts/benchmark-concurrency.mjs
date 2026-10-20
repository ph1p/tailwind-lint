#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const help = `Usage: node scripts/benchmark-concurrency.mjs [options]

Options:
  --cli <path>                 CLI bundle (default: dist/cli.cjs)
  --files <count>              Files per corpus (default: 80)
  --fix-lines <count>          Three fixable issues per line, 1-33 (default: 2)
  --runs <count>               Repetitions per concurrency (default: 3)
  --concurrency <list>         Comma-separated 1,2,4 values (default: 1,2,4)
  --mode <lint|fix|all>        Corpus to run (default: all)
  --output <path>              Save the JSON report
  --help                       Show this help
`;

function parseOptions(args) {
	if (args.includes("--help")) return { help: true };
	const values = {};
	const allowed = new Set([
		"--cli",
		"--files",
		"--fix-lines",
		"--runs",
		"--concurrency",
		"--mode",
		"--output",
	]);
	for (let i = 0; i < args.length; i++) {
		const token = args[i];
		const equals = token.indexOf("=");
		const flag = equals < 0 ? token : token.slice(0, equals);
		if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
		if (Object.hasOwn(values, flag))
			throw new Error(`Repeated option: ${flag}`);
		const value = equals < 0 ? args[++i] : token.slice(equals + 1);
		if (!value || value.startsWith("--"))
			throw new Error(`Missing value for ${flag}`);
		values[flag] = value;
	}
	const positive = (flag, fallback) => {
		const value = values[flag] ?? String(fallback);
		if (
			!/^\d+$/.test(value) ||
			!Number.isSafeInteger(Number(value)) ||
			Number(value) < 1
		) {
			throw new Error(`${flag} must be a positive integer`);
		}
		return Number(value);
	};
	const concurrency = (values["--concurrency"] ?? "1,2,4").split(",");
	if (
		concurrency.some((value) => !["1", "2", "4"].includes(value)) ||
		new Set(concurrency).size !== concurrency.length
	) {
		throw new Error(
			"--concurrency must be a comma-separated list of unique values from 1,2,4",
		);
	}
	const mode = values["--mode"] ?? "all";
	const fixLines = positive("--fix-lines", 2);
	if (fixLines > 33)
		throw new Error("--fix-lines must not exceed 33 (99 fixes per file)");
	if (!["lint", "fix", "all"].includes(mode)) {
		throw new Error("--mode must be lint, fix, or all");
	}
	return {
		cli: values["--cli"],
		files: positive("--files", 80),
		fixLines,
		runs: positive("--runs", 3),
		concurrency: concurrency.map(Number),
		mode,
		output: values["--output"],
	};
}

function corpus(mode, count, fixLines) {
	const line =
		mode === "lint"
			? '<div class="block flex text-left text-center p-4 w-50">Example</div>'
			: '<div class="p-[16px] w-[200px] top-[60px]">Example</div>';
	const repetitions = mode === "lint" ? 100 : fixLines;
	const content = `${Array(repetitions).fill(line).join("\n")}\n`;
	return Array.from({ length: count }, (_, index) => ({
		relative: `src/${mode}-${String(index + 1).padStart(4, "0")}.html`,
		content,
	}));
}

async function writeCorpus(projectDir, files) {
	await Promise.all(
		files.map(({ relative, content }) =>
			fs.writeFile(path.join(projectDir, relative), content, "utf8"),
		),
	);
}

async function filesSha256(projectDir, files) {
	const hash = createHash("sha256");
	for (const file of [...files].sort((a, b) =>
		a.relative.localeCompare(b.relative),
	)) {
		hash.update(file.relative);
		hash.update("\0");
		hash.update(await fs.readFile(path.join(projectDir, file.relative)));
	}
	return hash.digest("hex");
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function runCli(cli, args, cwd) {
	return new Promise((resolve, reject) => {
		const started = performance.now();
		execFile(
			process.execPath,
			[cli, ...args],
			{
				cwd,
				encoding: "utf8",
				timeout: 120_000,
				maxBuffer: 128 * 1024 * 1024,
				windowsHide: true,
			},
			(error, stdout = "", stderr = "") => {
				const ms = performance.now() - started;
				if (error) {
					reject(
						new Error(
							`CLI failed (${error.message})${stderr ? `\n${stderr}` : ""}`,
						),
					);
				} else {
					resolve({ stdout, ms });
				}
			},
		);
	});
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(help);
		return;
	}
	const cliPath = path.resolve(
		options.cli ?? path.join(repoRoot, "dist", "cli.cjs"),
	);
	const cli = await fs.realpath(cliPath).catch(() => {
		throw new Error(`CLI bundle not found: ${cliPath}`);
	});
	const fixtureTailwind = await fs
		.realpath(
			path.join(
				repoRoot,
				"__tests__",
				"fixtures",
				"v4",
				"node_modules",
				"tailwindcss",
			),
		)
		.catch(() => {
			throw new Error("Installed Tailwind v4 fixture dependency was not found");
		});
	const tmpDir = path.resolve(os.tmpdir());
	const prefix = path.join(tmpDir, "tailwind-lint-bench-");
	const prefixRelative = path.relative(tmpDir, path.resolve(prefix));
	if (prefixRelative.startsWith("..") || path.isAbsolute(prefixRelative)) {
		throw new Error("Temporary project prefix must stay inside os.tmpdir()");
	}
	let projectDir;
	try {
		projectDir = await fs.mkdtemp(prefix);
		const relativeTemp = path.relative(tmpDir, path.resolve(projectDir));
		if (
			!relativeTemp ||
			relativeTemp.startsWith("..") ||
			path.isAbsolute(relativeTemp)
		) {
			throw new Error("Temporary project escaped os.tmpdir()");
		}
		await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
		await fs.mkdir(path.join(projectDir, "node_modules"), { recursive: true });
		await fs.writeFile(
			path.join(projectDir, "package.json"),
			JSON.stringify(
				{ name: "tailwind-lint-benchmark", private: true, type: "module" },
				null,
				2,
			) + "\n",
		);
		await fs.writeFile(
			path.join(projectDir, "src", "app.css"),
			'@import "tailwindcss";\n@source "./*.html";\n',
		);
		await fs.symlink(
			fixtureTailwind,
			path.join(projectDir, "node_modules", "tailwindcss"),
			process.platform === "win32" ? "junction" : "dir",
		);

		const modes = options.mode === "all" ? ["lint", "fix"] : [options.mode];
		const corpora = Object.fromEntries(
			modes.map((mode) => [
				mode,
				corpus(mode, options.files, options.fixLines),
			]),
		);
		for (const files of Object.values(corpora))
			await writeCorpus(projectDir, files);
		const groups = new Map();
		const baselines = new Map();
		const runRecords = [];

		for (const mode of modes) {
			const files = corpora[mode];
			for (let repetition = 0; repetition < options.runs; repetition++) {
				const shift = repetition % options.concurrency.length;
				const order = options.concurrency
					.slice(shift)
					.concat(options.concurrency.slice(0, shift));
				for (const concurrency of order) {
					if (mode === "fix") await writeCorpus(projectDir, files);
					const pattern = `src/${mode}-*.html`;
					const args = [
						pattern,
						"--config",
						"src/app.css",
						"--concurrency",
						String(concurrency),
						"--format",
						"json",
					];
					if (mode === "fix") args.push("--fix");
					const { stdout, ms } = await runCli(cli, args, projectDir);
					let output;
					try {
						output = JSON.parse(stdout.trim());
					} catch {
						throw new Error(`CLI returned invalid JSON in ${mode} mode`);
					}
					if (
						output.error ||
						output.ok !== true ||
						output.summary?.errors !== 0
					) {
						throw new Error(
							`CLI reported errors in ${mode} mode: ${output.error ?? JSON.stringify(output.summary)}`,
						);
					}
					const expectedProcessed = options.files + 1;
					if (output.summary.totalFilesProcessed !== expectedProcessed) {
						throw new Error(
							`${mode} corpus processed ${output.summary.totalFilesProcessed} files; expected ${expectedProcessed}`,
						);
					}
					const expected =
						mode === "lint"
							? options.files * 400
							: options.files * options.fixLines * 3;
					const actual =
						mode === "lint" ? output.summary.warnings : output.summary.fixed;
					if (actual !== expected)
						throw new Error(
							`${mode} corpus produced ${actual}; expected ${expected}`,
						);
					const normalized = structuredClone(output);
					if (normalized.config) {
						delete normalized.config.concurrency;
						normalized.config.cwd = "<project>";
						if (normalized.config.configPath) {
							normalized.config.configPath = path
								.relative(projectDir, normalized.config.configPath)
								.split(path.sep)
								.join("/");
						}
					}
					const outputSha256 = sha256(JSON.stringify(normalized));
					const stdoutSha256 = sha256(stdout.trim());
					const fileSha256 = await filesSha256(projectDir, files);
					const baseline = baselines.get(mode);
					if (
						baseline &&
						(baseline.outputSha256 !== outputSha256 ||
							baseline.fileSha256 !== fileSha256)
					) {
						throw new Error(
							`${mode} output or resulting files changed across concurrency runs`,
						);
					}
					baselines.set(mode, baseline ?? { outputSha256, fileSha256 });
					const record = {
						type: "run",
						mode,
						concurrency,
						repetition: repetition + 1,
						ms: Number(ms.toFixed(2)),
						outputSha256,
						stdoutSha256,
						fileSha256,
						summary: output.summary,
					};
					runRecords.push(record);
					const key = `${mode}:${concurrency}`;
					if (!groups.has(key)) groups.set(key, []);
					groups.get(key).push(record);
					console.log(JSON.stringify(record));
				}
			}
		}

		const aggregates = [...groups.entries()].map(([key, records]) => {
			const [mode, concurrency] = key.split(":");
			const times = records.map((record) => record.ms);
			const aggregate = {
				type: "group",
				mode,
				concurrency: Number(concurrency),
				runs: records.length,
				medianMs: Number(median(times).toFixed(2)),
				minMs: Math.min(...times),
				maxMs: Math.max(...times),
				summary: records[0].summary,
				outputSha256: records[0].outputSha256,
				fileSha256: records[0].fileSha256,
			};
			console.log(JSON.stringify(aggregate));
			return aggregate;
		});
		const report = {
			node: process.version,
			platform: process.platform,
			availableParallelism: os.availableParallelism(),
			fixLines: options.fixLines,
			cli,
			files: options.files,
			runsPerConcurrency: options.runs,
			concurrency: options.concurrency,
			mode: options.mode,
			runs: runRecords,
			groups: aggregates,
		};
		if (options.output) {
			const outputPath = path.resolve(options.output);
			await fs.mkdir(path.dirname(outputPath), { recursive: true });
			await fs.writeFile(
				outputPath,
				`${JSON.stringify(report, null, 2)}\n`,
				"utf8",
			);
		}
	} finally {
		if (projectDir) {
			const relativeTemp = path.relative(tmpDir, path.resolve(projectDir));
			if (
				relativeTemp &&
				!relativeTemp.startsWith("..") &&
				!path.isAbsolute(relativeTemp)
			) {
				await fs.rm(projectDir, { recursive: true, force: true });
			}
		}
	}
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
