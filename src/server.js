import { createApp, loadConfig } from './app.js';

const config = loadConfig();
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET not set — using a random one (sessions reset on restart). Required in production.');
}
const app = createApp(config);
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`Moonshots Community running at http://${host}:${port} (${config.production ? 'production' : 'development'})`);
});

// Slowloris-style protection.
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      app.locals.db.close();
      process.exit(0);
    });
  });
}
