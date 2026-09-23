import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "services/**", "tests/e2e/report/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "jsx-a11y/no-autofocus": "off", // single-purpose screens (OTP, search) benefit from focus
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
