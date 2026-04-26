import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude artifacts (stale worktrees, etc.)
    ".claude/**",
    // Migration scripts (run separately via tsx, not part of Next build)
    "scripts/**",
    // Legacy Supabase edge functions (decommissioned)
    "supabase/**",
  ]),
]);

export default eslintConfig;
