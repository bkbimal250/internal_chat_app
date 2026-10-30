import rateLimit from '@fastify/rate-limit';
export default async function registerRateLimit(app) {
  await app.register(rateLimit, {
    global: false,
    max: 10,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, message: 'Too many requests' }),
  });
}
