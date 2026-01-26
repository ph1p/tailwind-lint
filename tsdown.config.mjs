import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/linter.ts", "src/cli.ts"],
	format: "cjs",
	platform: "node",
	target: "node22",
	clean: true,
	sourcemap: false,
	inlineOnly: false,
	dts: true,
});
