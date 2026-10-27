import { describe, expect, it } from "vitest";
import { diffLines } from "../src/diff";

describe("diffLines", () => {
	it("returns no changes for identical content", () => {
		expect(diffLines("a\nb", "a\nb")).toEqual([]);
	});

	it("reports changed lines when line counts match", () => {
		expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
			{ line: 2, removed: "b", added: "B" },
		]);
	});

	it("reports the differing region when line counts differ", () => {
		expect(diffLines("a\nb\nc\nd", "a\nX\nd")).toEqual([
			{ line: 2, removed: "b", added: "X" },
			{ line: 3, removed: "c", added: undefined },
		]);
	});
});
