import path from "node:path";
import { describe, expect, it } from "vitest";
import { lint } from "../src/linter";

describe("Canonical Class Suggestions", () => {
	const testV4Dir = path.resolve(__dirname, "fixtures/v4");

	it("should suggest canonical classes for arbitrary spacing values", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/arbitrary-values.html"],
			autoDiscover: false,
		});

		expect(result.files).toHaveLength(1);
		const file = result.files[0];
		expect(file.diagnostics.length).toBeGreaterThan(0);

		// Check for specific canonical class suggestions
		const suggestions = file.diagnostics.map((d) => d.message);

		// Spacing utilities
		expect(suggestions).toContainEqual(
			"The class `top-[60px]` can be written as `top-15`",
		);
		expect(suggestions).toContainEqual(
			"The class `p-[16px]` can be written as `p-4`",
		);
		expect(suggestions).toContainEqual(
			"The class `m-[32px]` can be written as `m-8`",
		);
		expect(suggestions).toContainEqual(
			"The class `gap-[8px]` can be written as `gap-2`",
		);

		// Position utilities with rem
		expect(suggestions).toContainEqual(
			"The class `left-[3.75rem]` can be written as `left-15`",
		);
		expect(suggestions).toContainEqual(
			"The class `right-[2rem]` can be written as `right-8`",
		);
		expect(suggestions).toContainEqual(
			"The class `bottom-[4rem]` can be written as `bottom-16`",
		);

		// Z-index
		expect(suggestions).toContainEqual(
			"The class `z-[100]` can be written as `z-100`",
		);

		// Viewport units
		expect(suggestions).toContainEqual(
			"The class `min-h-[100vh]` can be written as `min-h-screen`",
		);

		// Width utilities
		expect(suggestions).toContainEqual(
			"The class `w-[200px]` can be written as `w-50`",
		);

		// Max-width
		expect(suggestions).toContainEqual(
			"The class `max-w-[1280px]` can be written as `max-w-7xl`",
		);

		// Layout utilities
		expect(suggestions).toContainEqual(
			"The class `space-x-[0.5rem]` can be written as `space-x-2`",
		);
		expect(suggestions).toContainEqual(
			"The class `inset-[1rem]` can be written as `inset-4`",
		);
	});

	it("should detect all diagnostic types", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/arbitrary-values.html"],
			autoDiscover: false,
		});

		const file = result.files[0];

		// All diagnostics should be suggestCanonicalClasses type
		file.diagnostics.forEach((diagnostic) => {
			expect(diagnostic.code).toBe("suggestCanonicalClasses");
			expect(diagnostic.severity).toBe(2); // Warning
		});
	});

	it("should report correct line numbers", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/arbitrary-values.html"],
			autoDiscover: false,
		});

		const file = result.files[0];

		// Find the top-[60px] diagnostic
		const topDiagnostic = file.diagnostics.find((d) =>
			d.message.includes("top-[60px]"),
		);

		expect(topDiagnostic).toBeDefined();
		expect(topDiagnostic?.range.start.line).toBeGreaterThanOrEqual(0);
	});
});
