import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
export default async function registerSwagger(app) {
  await app.register(swagger, {
    openapi: {
      info: { title: 'Company Chat API', version: '2.0.0' },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { persistAuthorization: false },
    uiHooks: { onRequest: [app.authenticate, app.adminOnly] },
  });
}
