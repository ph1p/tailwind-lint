import path from "node:path";
import { describe, expect, it } from "vitest";
import { lint } from "../src/linter";

describe("CSS Conflict Detection - v4", () => {
	const testV4Dir = path.resolve(__dirname, "fixtures/v4");

	it("should detect display property conflicts", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/css-conflicts.html"],
			autoDiscover: false,
		});

		expect(result.files).toHaveLength(1);
		const file = result.files[0];

		const conflicts = file.diagnostics.filter((d) => d.code === "cssConflict");
		expect(conflicts.length).toBeGreaterThan(0);

		const messages = conflicts.map((d) => d.message);

		expect(
			messages.some((m) => m.includes("block") && m.includes("flex")),
		).toBe(true);

		expect(
			messages.some((m) => m.includes("inline") && m.includes("inline-block")),
		).toBe(true);
	});

	it("should detect position property conflicts", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/css-conflicts.html"],
			autoDiscover: false,
		});

		const file = result.files[0];
		const conflicts = file.diagnostics.filter((d) => d.code === "cssConflict");
		const messages = conflicts.map((d) => d.message);

		expect(
			messages.some((m) => m.includes("static") && m.includes("fixed")),
		).toBe(true);

		expect(
			messages.some((m) => m.includes("relative") && m.includes("absolute")),
		).toBe(true);
	});

	it("should detect text alignment conflicts", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/css-conflicts.html"],
			autoDiscover: false,
		});

		const file = result.files[0];
		const conflicts = file.diagnostics.filter((d) => d.code === "cssConflict");
		const messages = conflicts.map((d) => d.message);

		expect(
			messages.some(
				(m) => m.includes("text-left") && m.includes("text-center"),
			),
		).toBe(true);
	});

	it("should report cssConflict diagnostics as warnings", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/css-conflicts.html"],
			autoDiscover: false,
		});

		const file = result.files[0];
		const conflicts = file.diagnostics.filter((d) => d.code === "cssConflict");

		conflicts.forEach((diagnostic) => {
			expect(diagnostic.severity).toBe(2);
			expect(diagnostic.code).toBe("cssConflict");
		});
	});

	it("should report correct line and column numbers for conflicts", async () => {
		const result = await lint({
			cwd: testV4Dir,
			patterns: ["src/css-conflicts.html"],
			autoDiscover: false,
		});

		const file = result.files[0];
		const conflicts = file.diagnostics.filter((d) => d.code === "cssConflict");

		conflicts.forEach((diagnostic) => {
			expect(diagnostic.range.start.line).toBeGreaterThanOrEqual(0);
			expect(diagnostic.range.start.character).toBeGreaterThanOrEqual(0);
			expect(diagnostic.range.end.line).toBeGreaterThanOrEqual(
				diagnostic.range.start.line,
			);
			expect(diagnostic.range.end.character).toBeGreaterThan(0);
		});
	});
});
