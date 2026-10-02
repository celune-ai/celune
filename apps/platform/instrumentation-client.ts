import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  enableLogs: true,

  integrations: [
    Sentry.replayIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
  ],

  // Propagation-aware sampling: inherit parent, 10% for new client traces
  tracesSampler: (samplingContext) => {
    if (samplingContext.parentSampled !== undefined) {
      return samplingContext.parentSampled ? 1.0 : 0;
    }
    return 0.1;
  },

  // Session Replay — capture 10% of sessions, 100% on error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

// Next.js 16 router transition tracking
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
