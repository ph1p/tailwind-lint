import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectRootFontSize } from "../src/utils/root-font-size";

describe("detectRootFontSize", () => {
	let tmpDir: string;
	let cssPath: string;

	const write = (file: string, content: string) =>
		fs.writeFileSync(path.join(tmpDir, file), content, "utf-8");

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailwind-root-font-"));
		cssPath = path.join(tmpDir, "app.css");
		write("app.css", '@import "tailwindcss";');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should detect an arbitrary text size on the <html> tag", async () => {
		write(
			"layout.tsx",
			'<html lang="en" className="h-full text-[10px]"><body /></html>',
		);
		write("page.tsx", '<div className="text-[14px]" />');

		expect(
			await detectRootFontSize(tmpDir, cssPath, ["layout.tsx", "page.tsx"]),
		).toEqual({ size: 10, source: "detected from layout.tsx" });
	});

	it("should detect an inline font size on the <html> tag", async () => {
		write("index.html", '<html style="font-size: 62.5%"></html>');

		expect(await detectRootFontSize(tmpDir, cssPath, ["index.html"])).toEqual({
			size: 10,
			source: "detected from index.html",
		});
	});

	it("should detect an html or :root font size in the CSS config", async () => {
		write(
			"app.css",
			'@import "tailwindcss";\n@layer base {\n  :root, html { font-size: 12px; }\n}',
		);

		expect(await detectRootFontSize(tmpDir, cssPath, [])).toEqual({
			size: 12,
			source: "detected from app.css",
		});
	});

	it("should give up when files disagree", async () => {
		write("a.tsx", '<html className="text-[10px]" />');
		write("b.tsx", '<html className="text-[12px]" />');

		expect(
			await detectRootFontSize(tmpDir, cssPath, ["a.tsx", "b.tsx"]),
		).toBeUndefined();
	});

	it("should ignore font sizes outside the <html> tag", async () => {
		write("page.tsx", '<body className="text-[10px]" />');
		write("app.css", "body { font-size: 10px; }");

		expect(
			await detectRootFontSize(tmpDir, cssPath, ["page.tsx"]),
		).toBeUndefined();
	});
});
