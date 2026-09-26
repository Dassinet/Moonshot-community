import { networkInterfaces } from 'node:os';
import { bootstrap, createApp } from './app.js';

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET not set — using a secret stored in the database. Setting it explicitly is recommended in production.');
}
const { config, db } = await bootstrap();
const app = createApp(config, db);
const port = Number(process.env.PORT) || 3000;
// `--lan` listens on your Wi-Fi network so you can open the app on your phone.
const lan = process.argv.includes('--lan');
const host = process.env.HOST || (lan ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(port, host, () => {
  console.log(`Moonshots Community running at http://127.0.0.1:${port} (${config.production ? 'production' : 'development'}, ${db.kind} database)`);
  if (lan) {
    const ips = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    console.log('📱 On a phone connected to the same Wi-Fi, open:');
    for (const ip of ips) console.log(`   http://${ip}:${port}`);
  }
});

// Slowloris-style protection.
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
}
