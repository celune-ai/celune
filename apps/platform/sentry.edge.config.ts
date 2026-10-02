import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  enableLogs: true,

  integrations: [Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] })],

  // Propagation-aware sampling: inherit parent decision, 20% for new traces
  tracesSampler: (samplingContext) => {
    if (samplingContext.parentSampled !== undefined) {
      return samplingContext.parentSampled ? 1.0 : 0;
    }
    return 0.2;
  },
});
