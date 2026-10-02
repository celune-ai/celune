import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  enableLogs: true,

  integrations: [Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] })],

  // Propagation-aware sampling: always continue a trace if one exists upstream,
  // otherwise sample at 20% for new server-originated traces.
  tracesSampler: (samplingContext) => {
    // Always inherit the parent's sampling decision
    if (samplingContext.parentSampled !== undefined) {
      return samplingContext.parentSampled ? 1.0 : 0;
    }
    // Health checks and internal routes: don't trace
    const url = samplingContext.attributes?.['http.target'] as string | undefined;
    if (url?.startsWith('/api/health') || url?.startsWith('/_next')) {
      return 0;
    }
    // New root traces: 20%
    return 0.2;
  },
});
