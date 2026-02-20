const isLocalDryRun = process.env.SEMREL_LOCAL === "1";
const commitAnalyzerConfig = {
	releaseRules: [
		{ breaking: true, release: "major" },
		{ type: "feat", release: "minor" },
		{ type: "fix", release: "patch" },
		{ type: "perf", release: "patch" },
		{ type: "revert", release: "patch" },
	],
};

/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
	branches: ["main"],
	plugins: isLocalDryRun
		? [["@semantic-release/commit-analyzer", commitAnalyzerConfig]]
		: [
				["@semantic-release/commit-analyzer", commitAnalyzerConfig],
				"@semantic-release/release-notes-generator",
				"@semantic-release/npm",
				"@semantic-release/github",
			],
};
