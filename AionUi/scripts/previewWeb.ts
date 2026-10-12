/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer } from 'vite';
import configFactory from '../packages/desktop/electron.vite.config';

// Reuse the desktop renderer configuration without requiring Electron to run.
const config = await configFactory({ mode: 'development', command: 'serve' } as never);
const server = await createServer({
  ...config.renderer,
  configFile: false,
  server: {
    ...config.renderer?.server,
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    // Browser mode uses same-origin authentication, APIs and WebSockets.
    proxy: {
      '/api': { target: 'http://127.0.0.1:25809', ws: true },
      '/login': { target: 'http://127.0.0.1:25809' },
      '/logout': { target: 'http://127.0.0.1:25809' },
      '/ws': { target: 'http://127.0.0.1:25809', ws: true },
    },
  },
});

await server.listen();
server.printUrls();
