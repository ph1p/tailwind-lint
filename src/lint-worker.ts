import { parentPort, workerData } from "node:worker_threads";
import {
	collectCanonicalCandidates,
	installCanonicalCache,
	prepareCanonicalCache,
	type CanonicalRequest,
} from "./canonical-cache";
import { initializeState, processFiles } from "./file-processor";
import type { LintFileResult } from "./types";
import type { WorkerCommand, WorkerInput, WorkerMessage } from "./worker-pool";

async function run() {
	const { cwd, fix, verbose, tasks } = workerData as WorkerInput;
	const initialized = [];
	const canonicalRequests: CanonicalRequest[] = [];
	for (const task of tasks) {
		initialized.push({
			...task,
			state: await initializeState(cwd, task.target, verbose),
		});
	}
	for (const task of initialized) {
		canonicalRequests.push(
			...(await collectCanonicalCandidates(task.state, cwd, task.files)),
		);
	}
	const receive = () =>
		new Promise<WorkerCommand>((resolve) =>
			parentPort!.once("message", resolve),
		);
	let incoming = receive();
	parentPort!.postMessage({
		type: "ready",
		canonicalRequests,
	} satisfies WorkerMessage);
	for (;;) {
		const command = await incoming;
		if (command.type === "start") {
			for (const task of initialized)
				installCanonicalCache(task.state, command.caches);
			break;
		}
		incoming = receive();
		const caches = initialized.flatMap((task) =>
			prepareCanonicalCache(task.state, command.requests),
		);
		parentPort!.postMessage({
			type: "prepared",
			caches,
		} satisfies WorkerMessage);
	}
	const files: LintFileResult[] = [];
	for (const task of initialized) {
		files.push(
			...(await processFiles(
				task.state,
				cwd,
				task.files,
				fix,
				(_current, _total, file) => {
					parentPort!.postMessage({
						type: "progress",
						file,
					} satisfies WorkerMessage);
				},
			)),
		);
	}
	parentPort!.postMessage({ type: "result", files } satisfies WorkerMessage);
	parentPort!.close();
}

void run();
