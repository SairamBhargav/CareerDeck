// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // server/ is a Node service with its own package.json and tsconfig — the Expo rules
    // do not apply to it. `expo/no-dynamic-env-var` in particular exists because Expo
    // inlines process.env at bundle time; on a server, reading env vars by name is the
    // normal thing to do.
    ignores: ["dist/*", "server/*"],
  }
]);
