export const DEFAULT_IGNORE_PATTERNS = [
	"**/node_modules/**",
	"**/dist/**",
	"**/build/**",
	"**/.git/**",
	"**/.next/**",
	"**/.nuxt/**",
	"**/coverage/**",
	"**/.vscode/**",
	"**/.idea/**",
	"**/.cache/**",
	"**/.DS_Store/**",
];

export const DEFAULT_FILE_PATTERN =
	"./**/*.{js,jsx,ts,tsx,html,vue,svelte,astro,mdx}";

export const V3_CONFIG_PATHS = [
	"tailwind.config.js",
	"tailwind.config.cjs",
	"tailwind.config.mjs",
	"tailwind.config.ts",
];

export const V4_CSS_NAMES = [
	"app.css",
	"index.css",
	"tailwind.css",
	"globals.css",
	"global.css",
	"styles.css",
	"style.css",
	"main.css",
];

export const V4_CSS_FOLDERS = [
	"./",
	"./src/",
	"./src/css/",
	"./src/style/",
	"./src/styles/",
	"./app/",
	"./app/css/",
	"./app/style/",
	"./app/styles/",
	"./css/",
	"./style/",
	"./styles/",
];

export const LANGUAGE_MAP: Record<string, string> = {
	".astro": "astro",
	".css": "css",
	".erb": "erb",
	".hbs": "handlebars",
	".htm": "html",
	".html": "html",
	".js": "javascript",
	".jsx": "javascriptreact",
	".less": "less",
	".md": "markdown",
	".mdx": "mdx",
	".php": "php",
	".sass": "sass",
	".scss": "scss",
	".svelte": "svelte",
	".ts": "typescript",
	".tsx": "typescriptreact",
	".twig": "twig",
	".vue": "vue",
};

export const DEFAULT_VERSION = "0.0.1";

export const DEFAULT_TAB_SIZE = 2;

export const DEFAULT_SEPARATOR = ":";

export const DEFAULT_ROOT_FONT_SIZE = 16;

export const CONCURRENT_FILES = 10;

export const SEVERITY = {
	ERROR: 1,
	WARNING: 2,
} as const;

export const TERMINAL_WIDTH = 80;
export const TERMINAL_PADDING = 10;

export const MAX_FIX_ITERATIONS = 100;
export const QUICKFIX_ACTION_KIND = "quickfix";

export const TAILWIND_V4_IMPORT_PATTERNS = [
	'@import "tailwindcss"',
	"@import 'tailwindcss'",
] as const;

export const CSS_CONFIG_EXTENSION = ".css";

export function getLanguageId(filePath: string) {
	const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
	return LANGUAGE_MAP[ext] || "html";
}
