import { availableParallelism } from "node:os";
import type { LintOptions } from "./types";

export function resolveConcurrency(value: LintOptions["concurrency"] = 1) {
	if (value === "auto") return availableParallelism();
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error('Concurrency must be a positive integer or "auto".');
	}
	return value;
}
