import type { IncomingMessage } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/** Erzwingt dieselbe exakte Origin-Allowlist für Polling und WebSocket. */
export class ClientOriginSocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly clientOrigin: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.clientOrigin,
        credentials: true,
      },
      // CORS schützt nur HTTP-Polling. allowRequest gilt zusätzlich für den
      // echten WebSocket-Handshake, den der Client explizit verwendet.
      allowRequest: (
        request: IncomingMessage,
        callback: (error: string | null | undefined, success: boolean) => void,
      ) => {
        const allowed = request.headers.origin === this.clientOrigin;
        callback(allowed ? null : 'origin not allowed', allowed);
      },
    });
  }
}
