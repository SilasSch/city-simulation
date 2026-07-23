import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Socket, io as ioClient } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CONNECTION_ESTABLISHED_EVENT_TYPE,
  CONNECT_COMMAND_TYPE,
  PROTOCOL_ERROR_EVENT_TYPE,
  PROTOCOL_VERSION,
  ProtocolMessage,
  connectionEstablishedPayloadSchema,
  createMessage,
  protocolEnvelopeSchema,
  protocolErrorPayloadSchema,
} from '@city/game-protocol';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { SESSION_COOKIE_NAME } from '../auth/session-cookie.service';
import { PrismaService } from '../persistence/prisma.service';
import { cleanDatabase } from '../../test/test-database';
import { PROTOCOL_CHANNEL } from './realtime.gateway';

/**
 * WebSocket-Tests gegen die echte Testdatenbank. Seit ADR 0007 wird der
 * Socket.IO-Handshake authentifiziert: ohne gültige Session wird die
 * Verbindung abgelehnt, mit Session laufen die technischen
 * Protokollfunktionen wie bisher.
 */
describe('RealtimeGateway (websocket)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let prisma: PrismaService;
  let port: number;
  const openSockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    auth = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) socket.disconnect();
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSessionCookie(email: string): Promise<string> {
    const result = await auth.register(email, 'geheim-123');
    return `${SESSION_COOKIE_NAME}=${result.sessionToken}`;
  }

  function connectSocket(cookie?: string): {
    socket: Socket;
    connected: Promise<void>;
    failed: Promise<Error>;
  } {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      ...(cookie !== undefined ? { extraHeaders: { Cookie: cookie } } : {}),
    });
    openSockets.push(socket);
    return {
      socket,
      connected: new Promise((resolve) =>
        socket.on('connect', () => resolve()),
      ),
      failed: new Promise((resolve) =>
        socket.on('connect_error', (error) => resolve(error)),
      ),
    };
  }

  function nextMessage(socket: Socket): Promise<ProtocolMessage<unknown>> {
    return new Promise((resolve) =>
      socket.once(PROTOCOL_CHANNEL, (data: ProtocolMessage<unknown>) =>
        resolve(data),
      ),
    );
  }

  it('rejects connections without a session cookie', async () => {
    const { socket, connected, failed } = connectSocket();

    const error = await failed;
    expect(error.message).toBeDefined();
    expect(socket.connected).toBe(false);
    await expect(
      Promise.race([
        connected.then(() => 'connected'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 200)),
      ]),
    ).resolves.toBe('timeout');
  });

  it('rejects connections with an invalid session token', async () => {
    const { socket, failed } = connectSocket(
      `${SESSION_COOKIE_NAME}=ungueltiges-token`,
    );

    await failed;
    expect(socket.connected).toBe(false);
  });

  it('rejects connections with an expired session', async () => {
    const cookie = await createSessionCookie('expired@example.com');
    const token = cookie.slice(`${SESSION_COOKIE_NAME}=`.length);
    await prisma.session.update({
      where: { id: token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const { socket, failed } = connectSocket(cookie);

    await failed;
    expect(socket.connected).toBe(false);
  });

  it('answers a valid connect command with a connection-established event', async () => {
    const cookie = await createSessionCookie('player@example.com');
    const { socket, connected } = connectSocket(cookie);
    await connected;

    const requestId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const responsePromise = nextMessage(socket);

    socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(
        CONNECT_COMMAND_TYPE,
        { clientName: 'spec-client' },
        requestId,
      ),
    );

    const response = await responsePromise;
    expect(protocolEnvelopeSchema.safeParse(response).success).toBe(true);
    expect(response.type).toBe(CONNECTION_ESTABLISHED_EVENT_TYPE);
    expect(response.version).toBe(PROTOCOL_VERSION);
    expect(response.requestId).toBe(requestId);
    expect(
      connectionEstablishedPayloadSchema.safeParse(response.payload).success,
    ).toBe(true);
  });

  it('rejects an unsupported protocol version and does not execute the command', async () => {
    const cookie = await createSessionCookie('version@example.com');
    const { socket, connected } = connectSocket(cookie);
    await connected;

    const requestId = '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const responsePromise = nextMessage(socket);

    socket.emit(PROTOCOL_CHANNEL, {
      ...createMessage(
        CONNECT_COMMAND_TYPE,
        { clientName: 'spec-client' },
        requestId,
      ),
      version: PROTOCOL_VERSION + 1,
    });

    const response = await responsePromise;
    expect(protocolEnvelopeSchema.safeParse(response).success).toBe(true);
    expect(response.type).toBe(PROTOCOL_ERROR_EVENT_TYPE);

    const payload = protocolErrorPayloadSchema.parse(response.payload);
    expect(payload.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
    expect(payload.supportedVersion).toBe(PROTOCOL_VERSION);
    expect(payload.receivedVersion).toBe(PROTOCOL_VERSION + 1);
    expect(payload.requestId).toBe(requestId);
    expect(socket.connected).toBe(true); // Verbindung bleibt offen (ADR 0006)
  });

  it('rejects malformed messages with INVALID_MESSAGE', async () => {
    const cookie = await createSessionCookie('malformed@example.com');
    const { socket, connected } = connectSocket(cookie);
    await connected;

    const responsePromise = nextMessage(socket);

    socket.emit(PROTOCOL_CHANNEL, { garbage: true });

    const response = await responsePromise;
    expect(response.type).toBe(PROTOCOL_ERROR_EVENT_TYPE);
    const payload = protocolErrorPayloadSchema.parse(response.payload);
    expect(payload.code).toBe('INVALID_MESSAGE');
  });
});
