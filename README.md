# Tailwind CSS Linter (CLI)

A command-line tool that uses the Tailwind CSS IntelliSense engine to lint your Tailwind classes.

Supports **Tailwind CSS v4** (CSS-based config) and **v3** (JavaScript config, legacy).

## Features

**Core (v3 & v4):**
- CSS Conflicts - Detects when multiple classes apply the same CSS properties
- Invalid @apply Usage - Validates if a class can be used with `@apply`
- Invalid @screen References - Detects references to non-existent breakpoints
- Invalid Config Paths - Validates references in `config()` and `theme()` functions
- Invalid @tailwind Directives - Validates `@tailwind` layer values
- Recommended Variant Order - Suggests preferred ordering of variants
- Blocklisted Classes - Detects usage of blocklisted classes
- Autofix - Automatically fix issues with `--fix` flag

**v4-Specific:**
- Canonical Class Suggestions - Suggests shorthand equivalents for arbitrary values (e.g., `top-[60px]` → `top-15`)
- Invalid @source Directives - Validates `@source` directive paths
- Full theme loading - Automatically loads Tailwind's default theme

## Requirements

- Node.js >= 22.0.0
- Tailwind CSS v4 or v3 (installed in your project)

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
tailwind-lint [options] [files...]
```

### Options

- `-c, --config <path>` - Path to Tailwind config file (default: auto-discover)
- `-a, --auto` - Auto-discover files from config content patterns (v3 only)
- `--fix` - Automatically fix problems that can be fixed
- `-v, --verbose` - Enable verbose logging for debugging
- `-h, --help` - Show help message
- `--version` - Show version number

### Examples

**Tailwind CSS v4:**
```bash
# Lint files
tailwind-lint "src/**/*.{js,jsx,ts,tsx}"

# With CSS config
tailwind-lint "src/**/*.tsx" --config ./app.css

# Fix issues (including canonical class suggestions)
tailwind-lint "src/**/*.html" --fix

# Verbose mode for debugging
tailwind-lint "src/**/*.tsx" --verbose
```

**Tailwind CSS v3 (Legacy):**
```bash
# With JavaScript config
tailwind-lint --config ./tailwind.config.js

# Auto-discover from config content patterns
tailwind-lint --auto

# Fix issues
tailwind-lint --config ./tailwind.config.js --fix

# Debug with verbose logging
tailwind-lint --auto --verbose
```

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

### Tailwind CSS v3 (Legacy)

Create a JavaScript config file (`tailwind.config.js`):

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

## Autofix

Use `--fix` to automatically resolve issues:

- **Canonical class suggestions** (v4) - Replaces arbitrary values with standard classes
- **Recommended variant order** (v3 & v4) - Reorders variants correctly

Files are written atomically with multiple iterations to ensure all fixes are applied.

## Output Examples

**Issues found:**
```
src/example.html
  10:8   warning  'p-4' applies the same CSS properties as 'px-8'  (cssConflict)
  13:8   warning  'text-red-500' applies the same CSS properties as 'text-blue-500'  (cssConflict)

Found 2 warnings in 1 file
```

**With --fix:**
```
src/components.html
  ✔ Fixed 2 issues

✔ Fixed 2 issues
```

**With --verbose:**
```
→ Running in verbose mode
  Working directory: /path/to/project
  Config path: auto-discover
  Fix mode: false
  Patterns: src/**/*.tsx

→ Initializing Tailwind CSS language service...
  Tailwind version: 4.1.18
  Config type: CSS (v4)
  Config path: /path/to/project/app.css
  ✓ Loaded v4 design system
  ✓ State initialized successfully

→ Discovered 15 files to lint
  [1/15] Linting src/components/Button.tsx
  [2/15] Linting src/components/Card.tsx
  ...

src/components/Button.tsx
  10:8   warning  'p-4' applies the same CSS properties as 'px-8'  (cssConflict)

Found 1 warning in 1 file
```

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
```
