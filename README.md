# Tailwind CSS Linter (CLI)

[![](https://img.shields.io/npm/v/tailwind-lint)](https://www.npmjs.com/package/tailwind-lint) ![](https://github.com/ph1p/tailwind-lint/actions/workflows/ci.yml/badge.svg) ![](https://github.com/ph1p/tailwind-lint/actions/workflows/release.yml/badge.svg)

It just lints your Tailwind project as the IDE will do, just on the command line.
Supports **Tailwind CSS v4** (CSS config files and Vite projects using `@tailwindcss/vite`) and **v3** (JavaScript config, legacy).

## Installation

```bash
# npm
npm install -g tailwind-lint

# pnpm
pnpm add -g tailwind-lint

# npx (no installation)
npx tailwind-lint "src/**/*.html"

# pnpm dlx (no installation)
pnpm dlx tailwind-lint "src/**/*.html"
```

## Usage

```bash
# fastest way to lint and fix issues
npx tailwind-lint --auto --fix

tailwind-lint [options] [files...]
```

### Quick Start

Simply run `tailwind-lint` in your project directory - it automatically discovers your Tailwind config and files:

```bash
# Auto-discover config and lint files
tailwind-lint

# Fix issues automatically
tailwind-lint --fix

# Verbose mode for debugging
tailwind-lint --verbose
```

### How Auto-Discovery Works

**Tailwind CSS v4:**

- Finds CSS config files in common locations: `app.css`, `index.css`, `tailwind.css`, `global.css`, etc.
- Searches in project root and subdirectories: `./`, `./src/`, `./src/styles/`, `./app/`, etc.
- Detects `vite.config.*` files that use `@tailwindcss/vite`
- Prefers real CSS configs when present, so custom `@theme` tokens and `@source` directives are available to diagnostics
- Uses file patterns from `@source` directives if present
- Falls back to default pattern: `./**/*.{js,jsx,ts,tsx,html,vue,svelte,astro,mdx}`
- **Note:** When CSS config is in a subdirectory (e.g., `src/styles/global.css`), files are discovered from the project root

**Tailwind CSS v3:**

- Finds JavaScript config files: `tailwind.config.js`, `tailwind.config.cjs`, `tailwind.config.mjs`, `tailwind.config.ts`
- Uses file patterns from the `content` array in your config

### Options

- `-c, --config <path>` - Path to Tailwind config file (default: auto-discover)
- `-a, --auto` - Auto-discover files from the resolved Tailwind config or CSS `@source` directives
- `--fix` - Automatically fix problems that can be fixed
- `--format <text|json>` - Output format (`text` default, `json` for machine-readable output)
- `-v, --verbose` - Enable verbose logging for debugging
- `-h, --help` - Show help message
- `--version` - Show version number

### Advanced Examples

```bash
# Lint specific files only
tailwind-lint "src/**/*.{js,jsx,ts,tsx}"

# Specify a custom config location
tailwind-lint --config ./config/tailwind.config.js

# Scan files based on an explicit config
tailwind-lint --config ./src/app.css

# Lint and fix specific file types
tailwind-lint "**/*.vue" --fix

# Lint with a specific CSS config (v4)
tailwind-lint --config ./styles/app.css

# Lint a Vite-based Tailwind v4 project
tailwind-lint --auto

# Machine-readable output for LLMs/agents
tailwind-lint --auto --format json
```

## LLM / Agent Integration

Use JSON output to avoid brittle text parsing:

```bash
tailwind-lint --auto --format json
```

The JSON payload includes:

- `ok` - `true` when no errors are found
- `summary` - counts for `errors`, `warnings`, `fixed`, `filesWithIssues`, `totalFilesProcessed`
- `config` - resolved runtime values (`cwd`, `configPath`, `autoDiscover`, `fix`, `patterns`)
- `files[]` - per-file diagnostics with 1-based `line`/`column` ranges

On JSON errors, the CLI keeps the same top-level shape and adds `error` so agent integrations do not need a separate parser for failure cases.

Typical agent flow:

1. Run `tailwind-lint --auto --format json`.
2. If `summary.errors > 0`, fail the check and surface diagnostics.
3. If only warnings exist, optionally continue and open a cleanup task.
4. Re-run with `--fix` when autofix is allowed.

## Configuration

### Tailwind CSS v4

Create a CSS config file (`app.css`, `index.css`, or `tailwind.css`):

```css
@import "tailwindcss";

@theme {
	--color-primary: #3b82f6;
}

@source "./src/**/*.{js,jsx,ts,tsx,html}";
```

The CLI auto-detects configs at: `app.css`, `src/app.css`, `index.css`, `src/index.css`, `tailwind.css`, `src/tailwind.css`

You can also use a Vite-based Tailwind v4 project with `@tailwindcss/vite` and no standalone Tailwind CSS config file:

```ts
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
});
```

If a real CSS config is also present, the CLI uses that file so custom `@theme` tokens and `@source` directives are available to diagnostics.

### Workspace Settings

The CLI also reads Tailwind workspace settings from common editor config files so extraction behavior can match your editor more closely.

Supported locations:

- `.zed/settings.json`
- `.vscode/settings.json`

Supported settings:

- `classFunctions`
- `experimental.classRegex`
- `classAttributes`
- `includeLanguages`
- `files.exclude`
- `lint`

Zed format:

```json
{
	"lsp": {
		"tailwindcss-language-server": {
			"settings": {
				"classFunctions": ["cva", "cx"],
				"experimental": {
					"classRegex": ["tw=\"([^\"]*)\""]
				}
			}
		}
	}
}
```

VS Code format:

```json
{
	"tailwindCSS.classFunctions": ["cva", "cx"],
	"tailwindCSS.experimental": {
		"classRegex": ["tw=\"([^\"]*)\""]
	}
}
```

### Tailwind CSS v3 (Legacy)

Create a JavaScript config file (`tailwind.config.js`):

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./src/**/*.{js,jsx,ts,tsx}"],
	theme: {
		extend: {},
	},
	plugins: [],
};
```

## Autofix

Use `--fix` to automatically resolve issues:

- **Canonical class suggestions** (v4) - Replaces arbitrary values with standard classes
- **Recommended variant order** (v3 & v4) - Reorders variants correctly

Files are written atomically with multiple iterations to ensure all fixes are applied. The autofix process has a safety limit of 100 iterations per file to prevent infinite loops.

## Features

**Core (v3 & v4):**

- CSS Conflicts - Detects when multiple classes apply the same CSS properties (e.g., `block flex`, `text-left text-center`) - **Note:** Works reliably in v4, limited support in v3 - no autofix
- Invalid @apply Usage - Validates if a class can be used with `@apply`
- Invalid @screen References - Detects references to non-existent breakpoints
- Invalid Config Paths - Validates references in `config()` and `theme()` functions
- Invalid @tailwind Directives - Validates `@tailwind` layer values
- Recommended Variant Order - Suggests preferred ordering of variants
- Blocklisted Classes - Detects usage of blocklisted classes
- Autofix - Automatically fix issues with `--fix` flag
- Quoted class string extraction - Lints class-like strings in common helper patterns, not only direct `class` and `className` attributes

**v4-Specific:**

- Canonical Class Suggestions - Suggests shorthand equivalents for arbitrary values (e.g., `top-[60px]` → `top-15`)
- Invalid @source Directives - Validates `@source` directive paths
- Full theme loading - Automatically loads Tailwind's default theme

## Development

```bash
# Install dependencies
pnpm install

# Build for production
pnpm build

# Development mode (watch)
pnpm dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Format and lint code
pnpm format

# Check code without fixing
pnpm lint

# Preview next version locally (no publish)
pnpm release:dry
```

## Releases

Releases are automated with Semantic Release on pushes to `main`.

- Version bump is derived from Conventional Commits.
- npm release and GitHub release are generated automatically.
- npm publish uses npm Trusted Publishing (OIDC), no `NPM_TOKEN` required.

Commit examples:

- `feat: add json output mode` -> minor release
- `fix: resolve v4 config discovery in monorepos` -> patch release
- `feat: drop Node 20 support` + commit body `BREAKING CHANGE: Node 20 is no longer supported` -> major release
- `perf: speed up config discovery` -> patch release
- `docs: update readme` -> no release

`pnpm release:dry` runs against the local repo metadata (`--repository-url .`) so it does not require GitHub remote access.
