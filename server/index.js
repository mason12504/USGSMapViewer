// API server entry point.
//   npm run dev:api                      (inside the dev container: mock mode)
//   docker compose --profile real up api-real   (on your PC: live mode)

import { ConfigError, describeConfig, loadConfig } from './config.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[api] refusing to start: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

createApp(config).listen(config.port, config.host, () => {
  console.log('[api] listening', describeConfig(config));
});
