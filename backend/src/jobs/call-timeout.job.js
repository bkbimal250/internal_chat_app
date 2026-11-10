export async function expireStaleCalls(app) {
  if (!app.calls) return { expired: 0 };
  return app.calls.expireStale();
}
