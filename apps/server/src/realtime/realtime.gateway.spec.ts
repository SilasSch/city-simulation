import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Socket, io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { validateEnv } from '../core/config';
import { RealtimeModule } from './realtime.module';
import { PROTOCOL_CHANNEL } from './realtime.gateway';

process.env.DATABASE_URL ??=
  'postgresql://city:city@localhost:5432/city_simulation';

describe('RealtimeGateway (websocket)', () => {
  let app: INestApplication;
  let client: Socket;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        RealtimeModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;

    client = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));
  });

  afterAll(async () => {
    client.disconnect();
    await app.close();
  });

  function nextMessage(): Promise<ProtocolMessage<unknown>> {
    return new Promise((resolve) =>
      client.once(PROTOCOL_CHANNEL, (data: ProtocolMessage<unknown>) =>
        resolve(data),
      ),
    );
  }

  it('answers a valid connect command with a connection-established event', async () => {
    const requestId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const responsePromise = nextMessage();

    client.emit(
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
    const requestId = '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const responsePromise = nextMessage();

    client.emit(PROTOCOL_CHANNEL, {
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
    expect(client.connected).toBe(true); // Verbindung bleibt offen (ADR 0006)
  });

  it('rejects malformed messages with INVALID_MESSAGE', async () => {
    const responsePromise = nextMessage();

    client.emit(PROTOCOL_CHANNEL, { garbage: true });

    const response = await responsePromise;
    expect(response.type).toBe(PROTOCOL_ERROR_EVENT_TYPE);
    const payload = protocolErrorPayloadSchema.parse(response.payload);
    expect(payload.code).toBe('INVALID_MESSAGE');
  });
});
