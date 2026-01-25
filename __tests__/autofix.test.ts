import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lint } from "../src/linter";

describe("Autofix functionality", () => {
	const fixtureDir = path.join(__dirname, "fixtures", "v4");
	const testFilePath = path.join(fixtureDir, "src", "test-autofix-temp.html");

	beforeEach(() => {
		// Create a test file with issues that can be auto-fixed
		const testContent = `<!DOCTYPE html>
<html>
<head>
    <title>Test Autofix</title>
</head>
<body>
    <div class="p-[16px] w-[200px] top-[60px]">Test</div>
</body>
</html>
`;
		fs.writeFileSync(testFilePath, testContent, "utf-8");
	});

	afterEach(() => {
		// Clean up test file
		if (fs.existsSync(testFilePath)) {
			fs.unlinkSync(testFilePath);
		}
	});

	it("should detect issues without --fix", async () => {
		const results = await lint({
			cwd: fixtureDir,
			patterns: ["src/test-autofix-temp.html"],
			configPath: path.join(fixtureDir, "src", "app.css"),
			autoDiscover: false,
			fix: false,
		});

		expect(results.files).toHaveLength(1);
		expect(results.files[0].diagnostics).toHaveLength(3);
		expect(results.files[0].diagnostics[0].code).toBe(
			"suggestCanonicalClasses",
		);
		expect(results.files[0].fixed).toBeFalsy();
	});

	it("should fix issues with --fix", async () => {
		const results = await lint({
			cwd: fixtureDir,
			patterns: ["src/test-autofix-temp.html"],
			configPath: path.join(fixtureDir, "src", "app.css"),
			autoDiscover: false,
			fix: true,
		});

		expect(results.files).toHaveLength(1);
		expect(results.files[0].fixed).toBe(true);
		expect(results.files[0].fixedCount).toBe(3);

		// All issues should be fixed, so no diagnostics should remain
		expect(results.files[0].diagnostics).toHaveLength(0);

		// Verify the file content was actually changed
		const fixedContent = fs.readFileSync(testFilePath, "utf-8");
		expect(fixedContent).toContain("p-4");
		expect(fixedContent).toContain("w-50");
		expect(fixedContent).toContain("top-15");
		expect(fixedContent).not.toContain("p-[16px]");
		expect(fixedContent).not.toContain("w-[200px]");
		expect(fixedContent).not.toContain("top-[60px]");
	});

	it("should preserve file structure when fixing", async () => {
		const originalContent = fs.readFileSync(testFilePath, "utf-8");

		await lint({
			cwd: fixtureDir,
			patterns: ["src/test-autofix-temp.html"],
			configPath: path.join(fixtureDir, "src", "app.css"),
			autoDiscover: false,
			fix: true,
		});

		const fixedContent = fs.readFileSync(testFilePath, "utf-8");

		// Verify structure is preserved
		expect(fixedContent).toContain("<!DOCTYPE html>");
		expect(fixedContent).toContain("<title>Test Autofix</title>");
		expect(fixedContent).toContain("<div class=");

		// Verify only the classes were changed
		const originalLines = originalContent.split("\n");
		const fixedLines = fixedContent.split("\n");
		expect(fixedLines.length).toBe(originalLines.length);
	});

	it("should not modify files when no fixes are available", async () => {
		// Create a file with no fixable issues
		const cleanContent = `<!DOCTYPE html>
<html>
<head>
    <title>Clean File</title>
</head>
<body>
    <div class="p-4 w-50">Test</div>
</body>
</html>
`;
		const cleanFilePath = path.join(fixtureDir, "src", "test-clean-temp.html");
		fs.writeFileSync(cleanFilePath, cleanContent, "utf-8");

		try {
			const results = await lint({
				cwd: fixtureDir,
				patterns: ["src/test-clean-temp.html"],
				configPath: path.join(fixtureDir, "src", "app.css"),
				autoDiscover: false,
				fix: true,
			});

			expect(results.files).toHaveLength(0); // No files with issues

			// Verify file content was not changed
			const contentAfter = fs.readFileSync(cleanFilePath, "utf-8");
			expect(contentAfter).toBe(cleanContent);
		} finally {
			if (fs.existsSync(cleanFilePath)) {
				fs.unlinkSync(cleanFilePath);
			}
		}
	});
});
