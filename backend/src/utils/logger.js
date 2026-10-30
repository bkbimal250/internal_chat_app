import pino from 'pino';

export function loggerOptions(config) {
  return {
    level: config.logLevel,
    base: { service: 'company-chat-api', environment: config.nodeEnv },
    redact: {
      paths: [
        'password',
        'token',
        'databaseUrl',
        'DATABASE_URL',
        'POSTGRES_PASSWORD',
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    // Never serialize raw bodies, headers, query strings, or exception messages.
    serializers: {
      req: (req) => ({ method: req.method, path: req.url?.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
      err: () => ({ type: 'Error', message: 'Internal error details suppressed' }),
    },
  };
}

export const createLogger = (config) => pino(loggerOptions(config));
