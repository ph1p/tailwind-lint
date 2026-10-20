import * as path from "node:path";
import type { State } from "@tailwindcss/language-service";
import { DiagnosticKind, doValidate } from "@tailwindcss/language-service";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageId, MAX_FIX_ITERATIONS } from "./constants";
import { fileExists, readFileSync } from "./utils/fs";

export interface CanonicalOptions {
	rem?: number;
}

export interface CanonicalRequest {
	configPath: string;
	options: CanonicalOptions;
	candidates: string[];
}

export interface CanonicalCache {
	configPath: string;
	options: CanonicalOptions;
	entries: [string, string][];
}

function optionsKey(options?: CanonicalOptions) {
	return JSON.stringify(options || {});
}

/** Discover candidates through the same extraction/settings path as validation. */
export async function collectCanonicalCandidates(
	state: State,
	cwd: string,
	files: string[],
): Promise<CanonicalRequest[]> {
	const system = state.designSystem;
	const original = system?.canonicalizeCandidates;
	const configPath = state.configPath;
	if (!state.v4 || !system || typeof original !== "function" || !configPath) {
		return [];
	}

	const groups = new Map<
		string,
		{ options: CanonicalOptions; candidates: Set<string> }
	>();
	try {
		system.canonicalizeCandidates = (candidates, options) => {
			const key = optionsKey(options);
			let group = groups.get(key);
			if (!group) {
				group = { options: { ...options }, candidates: new Set() };
				groups.set(key, group);
			}
			for (const candidate of candidates) group.candidates.add(candidate);
			return candidates;
		};
		for (const file of files) {
			const absolutePath = path.resolve(cwd, file);
			if (!fileExists(absolutePath)) continue;
			const document = TextDocument.create(
				`file://${absolutePath}`,
				getLanguageId(absolutePath),
				1,
				readFileSync(absolutePath),
			);
			await doValidate(state, document, [
				DiagnosticKind.SuggestCanonicalClasses,
			]);
		}
		return [...groups.values()].map(({ options, candidates }) => ({
			configPath,
			options,
			candidates: [...candidates],
		}));
	} catch {
		// This is only a warmup: normal validation retains its error behavior.
		return [];
	} finally {
		system.canonicalizeCandidates = original;
	}
}

/** Warm each options group once, sharing only plain candidate/result strings. */
export function prepareCanonicalCache(
	state: State,
	requests: CanonicalRequest[],
): CanonicalCache[] {
	const system = state.designSystem;
	const original = system?.canonicalizeCandidates;
	const configPath = state.configPath;
	if (!state.v4 || !system || typeof original !== "function" || !configPath) {
		return [];
	}

	const groups = new Map<
		string,
		{ options: CanonicalOptions; candidates: Set<string> }
	>();
	for (const request of requests) {
		if (request.configPath !== configPath) continue;
		const key = optionsKey(request.options);
		let group = groups.get(key);
		if (!group) {
			group = { options: { ...request.options }, candidates: new Set() };
			groups.set(key, group);
		}
		for (const candidate of request.candidates) group.candidates.add(candidate);
	}

	const caches: CanonicalCache[] = [];
	for (const { options, candidates } of groups.values()) {
		try {
			const entries = new Map<string, string>();
			const seen = new Set<string>();
			let pending = [...candidates];
			for (
				let iteration = 0;
				pending.length && iteration < MAX_FIX_ITERATIONS;
				iteration++
			) {
				for (const candidate of pending) seen.add(candidate);
				const next = new Set<string>();
				for (const candidate of pending) {
					// Tailwind may merge aliases in multi-candidate calls. Match the
					// language service's singleton calls so each result stays aligned.
					const value = original.call(system, [candidate], options)[0];
					if (typeof value !== "string") continue;
					entries.set(candidate, value);
					// A replacement can introduce several classes in the next fix pass.
					for (const replacement of value.split(/\s+/).filter(Boolean)) {
						if (!seen.has(replacement)) next.add(replacement);
					}
				}
				pending = [...next];
			}
			caches.push({ configPath, options, entries: [...entries] });
		} catch {
			// A failed warmup must not prevent the authoritative validation pass.
		}
	}
	return caches;
}

/** Install a state-local lookup, retaining the real implementation for misses. */
export function installCanonicalCache(
	state: State,
	caches: CanonicalCache[],
): void {
	const system = state.designSystem;
	const original = system?.canonicalizeCandidates;
	const configPath = state.configPath;
	if (!state.v4 || !system || typeof original !== "function" || !configPath) {
		return;
	}

	const groups = new Map<string, Map<string, string>>();
	for (const cache of caches) {
		if (cache.configPath !== configPath) continue;
		const key = optionsKey(cache.options);
		const entries = groups.get(key) ?? new Map<string, string>();
		for (const [candidate, value] of cache.entries)
			entries.set(candidate, value);
		groups.set(key, entries);
	}
	if (groups.size === 0) return;

	system.canonicalizeCandidates = (candidates, options) => {
		// Only the singleton API used by diagnostics can be cached by candidate.
		if (candidates.length !== 1)
			return original.call(system, candidates, options);
		const key = optionsKey(options);
		const entries = groups.get(key) ?? new Map<string, string>();
		groups.set(key, entries);
		const candidate = candidates[0];
		if (entries.has(candidate)) return [entries.get(candidate)!];
		const canonical = original.call(system, candidates, options);
		if (typeof canonical[0] === "string") entries.set(candidate, canonical[0]);
		return canonical;
	};
}
