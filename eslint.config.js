import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/build",
    "**/coverage",
    "**/dist",
    "**/node_modules",
    "docs/api",
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2025,
      globals: globals.browser,
      parserOptions: {
        projectService: {
          defaultProject: "tsconfig.node.json",
          allowDefaultProject: [
            "eslint.config.js",
            "vitest.config.ts",
            "apps/*/vite.config.ts",
            "packages/*/vite.config.ts",
          ],
          // two apps and five packages: more config files than the default limit of 8
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-duplicate-imports": "error",
      "object-shorthand": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    files: [
      "apps/insituumaps/**/*.{js,jsx,ts,tsx}",
      "apps/tissuumaps/**/*.{js,jsx,ts,tsx}",
      "packages/@tissuumaps-react/**/*.{js,jsx,ts,tsx}",
    ],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    // plain Node scripts (fixture download, data server, smoke test)
    files: ["apps/insituumaps/scripts/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { projectService: false },
    },
  },
  eslintConfigPrettier,
]);
