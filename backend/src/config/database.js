export function poolOptions(config) {
  return {
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    connectionTimeoutMillis: config.dbConnectTimeoutMs,
    idleTimeoutMillis: 30000,
    query_timeout: config.dbQueryTimeoutMs,
    statement_timeout: config.dbQueryTimeoutMs,
    application_name: 'company-chat-api',
  };
}
