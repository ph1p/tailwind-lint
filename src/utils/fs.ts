import * as fs from "node:fs";
import * as path from "node:path";

export function fileExists(filePath: string) {
	try {
		return fs.existsSync(filePath);
	} catch {
		// Errors during existence check (e.g., permission issues) are treated as non-existent
		return false;
	}
}

export function readFileSync(filePath: string) {
	if (!filePath || typeof filePath !== "string") {
		throw new TypeError("File path must be a non-empty string");
	}
	return fs.readFileSync(filePath, "utf-8");
}

export function writeFileSync(filePath: string, content: string) {
	if (!filePath || typeof filePath !== "string") {
		throw new TypeError("File path must be a non-empty string");
	}
	if (typeof content !== "string") {
		throw new TypeError("Content must be a string");
	}
	fs.writeFileSync(filePath, content, "utf-8");
}

export function readGitignorePatterns(cwd: string): string[] {
	const gitignorePath = path.join(cwd, ".gitignore");

	if (!fileExists(gitignorePath)) {
		return [];
	}

	try {
		const content = fs.readFileSync(gitignorePath, "utf-8");
		return content
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
			.map((pattern) => {
				const cleaned = pattern.replace(/\/+$/, "");
				if (cleaned.includes("/") || cleaned.includes("*")) {
					return cleaned.endsWith("/**") ? cleaned : `${cleaned}/**`;
				}
				return `**/${cleaned}/**`;
			});
	} catch {
		return [];
	}
}
