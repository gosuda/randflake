import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      ".codex/**",
      ".omx/**",
      "dist/**",
      "node_modules/**",
      "src/randflake-ts/**/dist/**",
    ],
  },
  {
    files: ["src/randflake-ts/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
      },
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {},
  },
];
