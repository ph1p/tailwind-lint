import path from "node:path";
import type { State } from "@tailwindcss/language-service";
import { doValidate } from "@tailwindcss/language-service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectCanonicalCandidates,
	installCanonicalCache,
	prepareCanonicalCache,
	type CanonicalOptions,
	type CanonicalRequest,
} from "../src/canonical-cache";
import { MAX_FIX_ITERATIONS } from "../src/constants";
import { fileExists, readFileSync } from "../src/utils/fs";

vi.mock("@tailwindcss/language-service", () => ({
	doValidate: vi.fn(),
	DiagnosticKind: { SuggestCanonicalClasses: "suggestCanonicalClasses" },
}));
vi.mock("../src/utils/fs", () => ({
	fileExists: vi.fn(),
	readFileSync: vi.fn(),
}));

function fakeState(
	implementation: (
		candidates: string[],
		options?: CanonicalOptions,
	) => string[] = (candidates) => candidates,
	configPath = "/project/app.css",
) {
	const canonical = vi.fn(implementation);
	const state = {
		v4: true,
		configPath,
		designSystem: { canonicalizeCandidates: canonical },
	} as unknown as State;
	return { state, canonical };
}

function request(
	candidates: string[],
	options: CanonicalOptions = {},
): CanonicalRequest {
	return { configPath: "/project/app.css", options, candidates };
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(fileExists).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValue('custom("p-[16px]")');
});

describe("canonical candidate collection", () => {
	it("uses authoritative document validation, deduplicates requests, and restores the method", async () => {
		const { state, canonical } = fakeState();
		const settings = { classFunctions: ["custom"], rootFontSize: 20 };
		state.config = settings;
		vi.mocked(fileExists).mockImplementation(
			(file) => !file.endsWith("missing.html"),
		);
		vi.mocked(doValidate).mockImplementation(
			async (received, document, only) => {
				expect(received).toBe(state);
				expect(received.config).toBe(settings);
				expect(only).toEqual(["suggestCanonicalClasses"]);
				expect(document.languageId).toBe("typescriptreact");
				expect(document.uri).toBe(
					`file://${path.resolve("/project", "page.tsx")}`,
				);
				expect(document.getText()).toBe('custom("p-[16px]")');
				const candidates = ["p-[16px]", "p-[16px]", "m-[20px]"];
				expect(
					received.designSystem!.canonicalizeCandidates!(candidates, {
						rem: settings.rootFontSize,
					}),
				).toBe(candidates);
				return [];
			},
		);

		expect(
			await collectCanonicalCandidates(state, "/project", [
				"missing.html",
				"page.tsx",
			]),
		).toEqual([request(["p-[16px]", "m-[20px]"], { rem: 20 })]);
		expect(doValidate).toHaveBeenCalledTimes(1);
		expect(readFileSync).toHaveBeenCalledTimes(1);
		expect(canonical).not.toHaveBeenCalled();
		expect(state.designSystem!.canonicalizeCandidates).toBe(canonical);
	});

	it("returns no partial cache and restores the method when extraction fails", async () => {
		const { state, canonical } = fakeState();
		vi.mocked(doValidate).mockImplementation(async (received) => {
			received.designSystem!.canonicalizeCandidates!(["p-[16px]"], {});
			throw new Error("settings unavailable");
		});
		expect(
			await collectCanonicalCandidates(state, "/project", ["page.html"]),
		).toEqual([]);
		expect(state.designSystem!.canonicalizeCandidates).toBe(canonical);

		vi.mocked(readFileSync).mockImplementation(() => {
			throw new Error("unreadable");
		});
		expect(
			await collectCanonicalCandidates(state, "/project", ["page.html"]),
		).toEqual([]);
		expect(state.designSystem!.canonicalizeCandidates).toBe(canonical);
	});

	it("does nothing for v3 or a design system without canonicalization", async () => {
		const { state, canonical } = fakeState();
		state.v4 = false;
		expect(
			await collectCanonicalCandidates(state, "/project", ["page.html"]),
		).toEqual([]);
		state.v4 = true;
		delete state.designSystem!.canonicalizeCandidates;
		expect(
			await collectCanonicalCandidates(state, "/project", ["page.html"]),
		).toEqual([]);
		expect(doValidate).not.toHaveBeenCalled();
		expect(canonical).not.toHaveBeenCalled();
	});
});

describe("canonical cache preparation", () => {
	it("deduplicates each options batch, preserves this, and closes over fix-generated classes", () => {
		const replacements: Record<string, string> = {
			old: "middle extra",
			middle: "final",
			extra: "extra",
			final: "final",
		};
		const receivers: unknown[] = [];
		const { state, canonical } = fakeState(function (
			this: unknown,
			candidates,
		) {
			receivers.push(this);
			return candidates.map((candidate) => replacements[candidate]);
		});
		const caches = prepareCanonicalCache(state, [
			request(["old", "old"]),
			request(["old"]),
		]);
		expect(canonical.mock.calls.map(([candidates]) => candidates)).toEqual([
			["old"],
			["middle"],
			["extra"],
			["final"],
		]);
		expect(receivers.every((receiver) => receiver === state.designSystem)).toBe(
			true,
		);
		expect(caches).toEqual([
			{
				configPath: state.configPath,
				options: {},
				entries: [
					["old", "middle extra"],
					["middle", "final"],
					["extra", "extra"],
					["final", "final"],
				],
			},
		]);
	});

	it("isolates config paths and rem options, and skips a group whose warmup fails", () => {
		const { state, canonical } = fakeState((candidates, options) => {
			if (options?.rem === 20) throw new Error("failed warmup");
			return candidates;
		});
		const caches = prepareCanonicalCache(state, [
			request(["p-4"], { rem: 16 }),
			request(["p-4"], { rem: 20 }),
			{ ...request(["other"]), configPath: "/other/app.css" },
		]);
		expect(caches).toEqual([
			{
				configPath: state.configPath,
				options: { rem: 16 },
				entries: [["p-4", "p-4"]],
			},
		]);
		expect(canonical).toHaveBeenCalledTimes(2);
	});

	it("bounds divergent closure and stops cycles without repeating candidates", () => {
		const divergent = fakeState((candidates) =>
			candidates.map((candidate) => `${candidate}x`),
		);
		const caches = prepareCanonicalCache(divergent.state, [request(["x"])]);
		expect(divergent.canonical).toHaveBeenCalledTimes(MAX_FIX_ITERATIONS);
		expect(caches[0].entries).toHaveLength(MAX_FIX_ITERATIONS);
		const cycle = fakeState((candidates) =>
			candidates.map((candidate) => (candidate === "a" ? "b" : "a")),
		);
		prepareCanonicalCache(cycle.state, [request(["a"])]);
		expect(cycle.canonical).toHaveBeenCalledTimes(2);
	});
});

describe("state-local canonical cache installation", () => {
	it("serves cached singletons and memoizes unknown fix candidates", () => {
		const { state, canonical } = fakeState(function (
			this: unknown,
			candidates,
		) {
			expect(this).toBe(state.designSystem);
			return candidates.map((candidate) => candidate.toUpperCase());
		});
		installCanonicalCache(state, [
			{
				configPath: state.configPath!,
				options: { rem: 16 },
				entries: [
					["known", "cached"],
					["empty", ""],
				],
			},
		]);
		const run = state.designSystem!.canonicalizeCandidates!;
		expect(
			["known", "empty", "known"].flatMap((candidate) =>
				run([candidate], { rem: 16 }),
			),
		).toEqual(["cached", "", "cached"]);
		expect(canonical).not.toHaveBeenCalled();
		expect(run(["new"], { rem: 16 })).toEqual(["NEW"]);
		expect(canonical).toHaveBeenCalledExactlyOnceWith(["new"], { rem: 16 });
		expect(run(["new"], { rem: 16 })).toEqual(["NEW"]);
		expect(canonical).toHaveBeenCalledTimes(1);
	});

	it("keeps alias collisions aligned during preparation and preserves the native multi-candidate API", () => {
		const { state, canonical } = fakeState((candidates) => [
			...new Set(
				candidates.map((candidate) =>
					candidate === "p-[16px]" ? "p-4" : candidate,
				),
			),
		]);
		const caches = prepareCanonicalCache(state, [
			request(["p-[16px]", "p-4", "w-4"]),
		]);
		expect(caches[0].entries).toEqual([
			["p-[16px]", "p-4"],
			["p-4", "p-4"],
			["w-4", "w-4"],
		]);
		installCanonicalCache(state, caches);
		canonical.mockClear();
		const run = state.designSystem!.canonicalizeCandidates!;
		expect(run(["p-[16px]"])).toEqual(["p-4"]);
		expect(run(["w-4"])).toEqual(["w-4"]);
		expect(canonical).not.toHaveBeenCalled();
		expect(run(["w-4", "p-[16px]", "p-4", "w-4"])).toEqual(["w-4", "p-4"]);
		expect(canonical).toHaveBeenCalledExactlyOnceWith(
			["w-4", "p-[16px]", "p-4", "w-4"],
			undefined,
		);
	});

	it("keeps rem, config, and state-local fallback maps isolated", () => {
		const first = fakeState((candidates, options) =>
			candidates.map((candidate) => `${candidate}:${options?.rem}`),
		);
		const second = fakeState((candidates) => candidates.map(() => "second"));
		const caches = [
			{
				configPath: first.state.configPath!,
				options: { rem: 16 },
				entries: [["known", "cached"]] as [string, string][],
			},
			{
				configPath: "/other/app.css",
				options: { rem: 20 },
				entries: [["known", "wrong-config"]] as [string, string][],
			},
		];
		installCanonicalCache(first.state, caches);
		installCanonicalCache(second.state, caches);
		expect(
			first.state.designSystem!.canonicalizeCandidates!(["known"], { rem: 20 }),
		).toEqual(["known:20"]);
		expect(
			first.state.designSystem!.canonicalizeCandidates!(["fresh"], { rem: 16 }),
		).toEqual(["fresh:16"]);
		expect(
			second.state.designSystem!.canonicalizeCandidates!(["fresh"], {
				rem: 16,
			}),
		).toEqual(["second"]);
		expect(caches[0].entries).toEqual([["known", "cached"]]);
	});

	it("leaves unsupported states and unrelated configs alone and preserves fallback errors", () => {
		const { state, canonical } = fakeState(() => {
			throw new Error("real failure");
		});
		installCanonicalCache(state, [
			{ configPath: "/other/app.css", options: {}, entries: [["a", "b"]] },
		]);
		expect(state.designSystem!.canonicalizeCandidates).toBe(canonical);
		state.v4 = false;
		installCanonicalCache(state, [
			{ configPath: state.configPath!, options: {}, entries: [["a", "b"]] },
		]);
		expect(state.designSystem!.canonicalizeCandidates).toBe(canonical);
		state.v4 = true;
		installCanonicalCache(state, [
			{ configPath: state.configPath!, options: {}, entries: [["a", "b"]] },
		]);
		expect(() =>
			state.designSystem!.canonicalizeCandidates!(["missing"]),
		).toThrow("real failure");
	});
});
