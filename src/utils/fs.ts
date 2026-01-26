import * as fs from "node:fs";

export function fileExists(filePath: string): boolean {
	try {
		return fs.existsSync(filePath);
	} catch {
		// Errors during existence check (e.g., permission issues) are treated as non-existent
		return false;
	}
}

export function readFileSync(filePath: string): string {
	if (!filePath || typeof filePath !== "string") {
		throw new TypeError("File path must be a non-empty string");
	}
	return fs.readFileSync(filePath, "utf-8");
}

export function writeFileSync(filePath: string, content: string): void {
	if (!filePath || typeof filePath !== "string") {
		throw new TypeError("File path must be a non-empty string");
	}
	if (typeof content !== "string") {
		throw new TypeError("Content must be a string");
	}
	fs.writeFileSync(filePath, content, "utf-8");
}
