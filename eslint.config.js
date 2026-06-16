import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["assets/extensions/subagents/src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "prefer-const": "error",
      "no-var": "error",
      "no-console": "warn",
      "no-empty": "off",
      "no-unused-vars": "off",
      "no-useless-escape": "warn",
      "no-useless-assignment": "off",
      "no-control-regex": "off",
      "no-constant-condition": "off",
      "no-prototype-builtins": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-sparse-arrays": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "preserve-caught-error": "off",
    },
  },
);
