import * as path from "node:path";
import { Worker } from "node:worker_threads";
import type { CanonicalCache, CanonicalRequest } from "./canonical-cache";
import type { LintFileResult, LintOptions } from "./types";
import type { TailwindConfigTarget } from "./utils/config";

export interface WorkerTask {
	target: TailwindConfigTarget;
	files: string[];
}

export interface WorkerInput {
	cwd: string;
	fix: boolean;
	verbose: boolean;
	tasks: WorkerTask[];
}

export type WorkerMessage =
	| { type: "ready"; canonicalRequests: CanonicalRequest[] }
	| { type: "prepared"; caches: CanonicalCache[] }
	| { type: "progress"; file: string }
	| { type: "result"; files: LintFileResult[] };

export type WorkerCommand =
	| { type: "prepare"; requests: CanonicalRequest[] }
	| { type: "start"; caches: CanonicalCache[] };

export async function processWithWorkers(
	options: Pick<LintOptions, "cwd" | "fix" | "verbose" | "onProgress">,
	tasks: WorkerTask[],
	concurrency: number,
) {
	const total = tasks.reduce((count, task) => count + task.files.length, 0);
	const count = Math.min(concurrency, total);
	const workloads: WorkerTask[][] = Array.from({ length: count }, () => []);
	let nextWorker = 0;
	for (const task of tasks) {
		const partitions: string[][] = Array.from({ length: count }, () => []);
		for (const file of task.files) {
			partitions[nextWorker++ % count].push(file);
		}
		for (const [index, files] of partitions.entries()) {
			if (files.length > 0)
				workloads[index].push({ target: task.target, files });
		}
	}

	const workers: Worker[] = [];
	const requests: Array<{ worker: Worker; request: CanonicalRequest }> = [];
	const caches: CanonicalCache[] = [];
	let ready = 0;
	let preparing = 0;
	let processed = 0;
	let stopping = false;
	const start = () => {
		for (const worker of workers) {
			worker.postMessage({ type: "start", caches } satisfies WorkerCommand);
		}
	};
	const prepare = () => {
		const groups = new Map<
			string,
			{ request: CanonicalRequest; workers: Worker[]; candidates: Set<string> }
		>();
		for (const { worker, request } of requests) {
			const key = JSON.stringify([request.configPath, request.options]);
			let group = groups.get(key);
			if (!group) {
				group = { request, workers: [], candidates: new Set() };
				groups.set(key, group);
			}
			group.workers.push(worker);
			for (const candidate of request.candidates)
				group.candidates.add(candidate);
		}
		const assignments = new Map<Worker, CanonicalRequest[]>();
		for (const group of groups.values()) {
			const worker = group.workers.reduce((selected, current) =>
				(assignments.get(current)?.length ?? 0) <
				(assignments.get(selected)?.length ?? 0)
					? current
					: selected,
			);
			const assigned = assignments.get(worker) ?? [];
			assigned.push({ ...group.request, candidates: [...group.candidates] });
			assignments.set(worker, assigned);
		}
		preparing = assignments.size;
		if (preparing === 0) start();
		for (const [worker, assigned] of assignments) {
			worker.postMessage({
				type: "prepare",
				requests: assigned,
			} satisfies WorkerCommand);
		}
	};
	try {
		const results = await Promise.all(
			workloads.map(
				(tasks) =>
					new Promise<LintFileResult[]>((resolve, reject) => {
						const worker = new Worker(path.join(__dirname, "lint-worker.cjs"), {
							workerData: {
								cwd: options.cwd,
								fix: options.fix ?? false,
								verbose: options.verbose ?? false,
								tasks,
							} satisfies WorkerInput,
							stdout: true,
							stderr: true,
						});
						workers.push(worker);
						// Plugin and adapter logs must not corrupt JSON stdout.
						worker.stdout.pipe(process.stderr);
						worker.stderr.pipe(process.stderr);
						let completed = false;
						worker.on("message", (message: WorkerMessage) => {
							if (stopping) return;
							if (message.type === "ready") {
								for (const request of message.canonicalRequests)
									requests.push({ worker, request });
								// Prepare each config's canonical index once, before any fixes begin.
								if (++ready === count) prepare();
							} else if (message.type === "prepared") {
								caches.push(...message.caches);
								if (--preparing === 0) start();
							} else if (message.type === "result") {
								completed = true;
								resolve(message.files);
							} else {
								try {
									options.onProgress?.(++processed, total, message.file);
								} catch (error) {
									reject(error);
								}
							}
						});
						worker.once("error", reject);
						worker.once("messageerror", reject);
						worker.once("exit", (code) => {
							if (!completed) {
								reject(
									new Error(
										`Lint worker exited before completing (code ${code}).`,
									),
								);
							}
						});
					}),
			),
		);
		return results.flat();
	} finally {
		stopping = true;
		await Promise.all(workers.map((worker) => worker.terminate()));
	}
}
