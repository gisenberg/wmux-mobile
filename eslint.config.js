const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  globalIgnores([
    ".expo/**",
    "android/**",
    "coverage/**",
    "dist/**",
    "ios/**",
    "node_modules/**",
    "protocol/wmux.ts",
    "src/terminal/host/vendor/**",
    "test-results/**",
  ]),
  expoConfig,
  {
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
]);
