export interface ChangedLine {
	/** 1-based line number in the original content */
	line: number;
	removed?: string;
	added?: string;
}

/**
 * Minimal line diff for previewing fixes. Quickfixes rewrite class lists in
 * place, so lines usually map one-to-one; otherwise the region between the
 * common prefix and suffix is reported as removed/added.
 */
export function diffLines(before: string, after: string): ChangedLine[] {
	const a = before.split("\n");
	const b = after.split("\n");
	const changes: ChangedLine[] = [];

	if (a.length === b.length) {
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) {
				changes.push({ line: i + 1, removed: a[i], added: b[i] });
			}
		}
		return changes;
	}

	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}

	for (let i = start; i < Math.max(endA, endB); i++) {
		changes.push({
			line: i + 1,
			removed: i < endA ? a[i] : undefined,
			added: i < endB ? b[i] : undefined,
		});
	}
	return changes;
}
