import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/linter.ts", "src/cli.ts", "src/lint-worker.ts"],
	format: "cjs",
	platform: "node",
	target: "node22",
	clean: true,
	sourcemap: false,
	inlineOnly: false,
	tsconfig: "tsconfig.build.json",
	deps: { alwaysBundle: ["@tailwindcss/language-service"] },
	dts: true,
});
