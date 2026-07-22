import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthResponseDto } from '@city/shared-types';
import { PrismaService } from '../persistence/prisma.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController (integration)', () => {
  let app: INestApplication;
  const checkDatabase = vi.fn<() => Promise<boolean>>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { checkDatabase } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with database up', async () => {
    checkDatabase.mockResolvedValue(true);

    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(200);
    const body = response.body as HealthResponseDto;
    expect(body.status).toBe('ok');
    expect(body.server).toBe('up');
    expect(body.database).toBe('up');
    expect(typeof body.timestamp).toBe('string');
    // Keine sensiblen Verbindungsinformationen im Response
    expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
  });

  it('returns 503 with database down', async () => {
    checkDatabase.mockResolvedValue(false);

    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(503);
    const body = response.body as HealthResponseDto;
    expect(body.status).toBe('error');
    expect(body.database).toBe('down');
  });
});
