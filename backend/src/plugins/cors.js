import cors from '@fastify/cors';
export default async function registerCors(app, config) {
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Requested-With'],
  });
}
