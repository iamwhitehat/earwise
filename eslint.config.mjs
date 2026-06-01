import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React 19 shipped two new strict rules that flag patterns this
    // codebase uses deliberately:
    //   - react-hooks/set-state-in-effect: every "load from localStorage
    //     on mount" and "fetch on mount → setState" trips it. The
    //     hydration model relies on these effects; converting all to
    //     useSyncExternalStore / Suspense would be a large refactor with
    //     no observable behavior change. Demoted.
    //   - react-hooks/purity: Date.now() during render (for "minutes
    //     ago" labels, etc.) is intentional and inexpensive. Demoted.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  {
    // Node SEA launcher script is plain CommonJS by design.
    files: ["scripts/sea-launcher.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
