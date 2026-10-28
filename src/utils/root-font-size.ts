import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_ROOT_FONT_SIZE } from "../constants";

export interface RootFontSize {
	size: number;
	source: string;
}

const CSS_RULE_REGEX = /([^{}]*)\{([^{}]*)\}/g;
const CSS_FONT_SIZE_REGEX =
	/(?:^|[;\s])font-size\s*:\s*(\d*\.?\d+)(px|%|rem|em)\s*(?:;|$)/;
const HTML_TAG_REGEX = /<html\b[^>]*>/gi;
const HTML_FONT_SIZE_REGEX =
	/(?:\btext-\[|font-size\s*:\s*|fontSize\s*:\s*["']?)(\d*\.?\d+)(px|%|rem|em)?(?=[\]"'\s;,}]|$)/;

function toPixels(value: string, unit: string | undefined) {
	const number = Number.parseFloat(value);
	if (!(number > 0)) return undefined;
	if (unit === "%") return (number / 100) * DEFAULT_ROOT_FONT_SIZE;
	if (unit === "rem" || unit === "em") return number * DEFAULT_ROOT_FONT_SIZE;
	return number;
}

function fromCss(content: string) {
	for (const [, selector, body] of content.matchAll(CSS_RULE_REGEX)) {
		const selectors = selector
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.split(";")
			.at(-1)
			?.split(",")
			.map((s) => s.trim());
		if (!selectors) continue;
		if (!selectors.some((s) => s === "html" || s === ":root")) continue;
		const match = body.match(CSS_FONT_SIZE_REGEX);
		if (match) return toPixels(match[1], match[2]);
	}
	return undefined;
}

function fromMarkup(content: string) {
	for (const [tag] of content.matchAll(HTML_TAG_REGEX)) {
		const match = tag.match(HTML_FONT_SIZE_REGEX);
		if (match) return toPixels(match[1], match[2]);
	}
	return undefined;
}

/**
 * Guesses the root font size from an `html`/`:root` font-size in the CSS
 * config, or from a font size set on the `<html>` tag in the linted files.
 * Gives up when the files disagree.
 */
export async function detectRootFontSize(
	cwd: string,
	configPath: string,
	files: string[],
): Promise<RootFontSize | undefined> {
	const found = new Map<number, string>();

	await Promise.all(
		files.map(async (file) => {
			const content = await fs
				.readFile(path.resolve(cwd, file), "utf-8")
				.catch(() => "");
			if (!content.includes("<html")) return;
			const size = fromMarkup(content);
			if (size && !found.has(size)) found.set(size, file);
		}),
	);

	if (found.size === 0) {
		const css = await fs.readFile(configPath, "utf-8").catch(() => "");
		const size = fromCss(css);
		if (size) found.set(size, path.relative(cwd, configPath));
	}

	if (found.size !== 1) return undefined;
	const [[size, file]] = found;
	return { size, source: `detected from ${file}` };
}
