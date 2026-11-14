import { AppError } from '../utils/app-error.js';

export function installErrorHandler(app, config) {
  app.setErrorHandler((error, request, reply) => {
    if (error.code === '23505' || error.cause?.code === '23505') {
      error = new AppError('An account with these unique details already exists', 409, 'CONFLICT');
    }
    const statusCode = error.validation
      ? 400
      : error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;
    const code = error.validation
      ? 'VALIDATION_ERROR'
      : error instanceof AppError
        ? error.code
        : statusCode >= 500
          ? 'INTERNAL_SERVER_ERROR'
          : 'REQUEST_ERROR';
    request.log[statusCode >= 500 ? 'error' : 'warn']({ statusCode, code }, 'Request failed');
    const response = {
      error: {
        code,
        message:
          error instanceof AppError && (statusCode < 500 || error.code === 'SMS_UNAVAILABLE')
            ? error.message
            : error.validation
              ? 'Request validation failed'
              : statusCode >= 500
                ? 'Internal server error'
                : 'Request could not be processed',
        requestId: request.id,
      },
    };
    if (config.nodeEnv !== 'production' && error.validation) {
      response.error.details = error.validation.map(({ instancePath, keyword }) => ({
        path: instancePath,
        rule: keyword,
      }));
    }
    reply.code(statusCode).send(response);
  });
  app.setNotFoundHandler((_request, _reply) => {
    throw new AppError('Route not found', 404, 'NOT_FOUND');
  });
}
