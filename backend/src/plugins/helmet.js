import helmet from '@fastify/helmet';
export default async function registerHelmet(app) {
  await app.register(helmet);
}
