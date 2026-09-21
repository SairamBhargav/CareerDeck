// Sentry's wrapper around the Expo Metro config. It is the default config plus source
// map generation in the shape Sentry needs to symbolicate a native stack trace.
//
// Harmless when Sentry is switched off: it changes how the bundle is built, not what
// runs, and lib/observability.ts still never loads the SDK without a DSN.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
