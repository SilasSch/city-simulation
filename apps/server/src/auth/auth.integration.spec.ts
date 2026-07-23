import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import type { AuthSessionDto } from '@city/shared-types';
import { AppModule } from '../app.module';
import { PrismaService } from '../persistence/prisma.service';
import { cleanDatabase } from '../../test/test-database';

/**
 * Integrationstests gegen eine echte PostgreSQL-Testdatenbank
 * (test/global-setup.ts). Deckt Registrierung, Login, Session-Lebenszyklus
 * und die Zuordnung User ↔ PlayerProfile ab.
 */
describe('Auth (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function extractSessionCookie(response: request.Response): string {
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const sessionCookie = cookies.find((c: string) =>
      c.startsWith('city_session='),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    return (sessionCookie as string).split(';')[0];
  }

  async function registerUser(
    email = 'player@example.com',
    password = 'geheim-123',
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password });
  }

  it('register creates user and player profile and never stores the password in clear text', async () => {
    const response = await registerUser();

    expect(response.status).toBe(201);
    const body = response.body as AuthSessionDto;
    expect(body.userId).toBeDefined();
    expect(body.playerProfileId).toBeDefined();
    expect(body.email).toBe('player@example.com');

    const cookie = extractSessionCookie(response);
    expect(cookie.length).toBeGreaterThan('city_session='.length + 20);

    const user = await prisma.user.findUnique({
      where: { email: 'player@example.com' },
      include: { playerProfile: true, sessions: true },
    });
    if (!user?.playerProfile) {
      throw new Error('Registrierung muss User und PlayerProfile erzeugen');
    }
    // Kein Klartext-Passwort, sondern Argon2id-PHC-String.
    expect(user.passwordHash).not.toBe('geheim-123');
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash).not.toContain('geheim-123');
    // Registrierung erzeugt User UND PlayerProfile (1:1).
    expect(user.playerProfile.id).toBe(body.playerProfileId);
    // Registrierung startet direkt eine Session.
    expect(user.sessions).toHaveLength(1);
  });

  it('register normalizes the email (trim + lowercase)', async () => {
    const response = await registerUser('  Player@Example.COM ', 'geheim-123');
    expect(response.status).toBe(201);
    expect((response.body as AuthSessionDto).email).toBe('player@example.com');
  });

  it('register rejects a duplicate email with a stable error code', async () => {
    await registerUser();
    const response = await registerUser(
      'player@example.com',
      'anderes-passwort',
    );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_ALREADY_TAKEN');
  });

  it('register rejects invalid payloads', async () => {
    const shortPassword = await registerUser('a@example.com', 'kurz');
    expect(shortPassword.status).toBe(400);
    expect(shortPassword.body.code).toBe('VALIDATION_ERROR');

    const badEmail = await registerUser('keine-email', 'geheim-123');
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.code).toBe('VALIDATION_ERROR');
  });

  it('login with correct credentials creates a session', async () => {
    await registerUser();

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'player@example.com', password: 'geheim-123' });

    expect(response.status).toBe(200);
    const body = response.body as AuthSessionDto;
    expect(body.email).toBe('player@example.com');
    extractSessionCookie(response);

    const sessionCount = await prisma.session.count();
    expect(sessionCount).toBe(2); // eine aus register, eine aus login
  });

  it('login with wrong credentials fails with a neutral error (no account-existence leak)', async () => {
    await registerUser();

    const wrongPassword = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'player@example.com', password: 'falsch-123' });
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'unknown@example.com', password: 'geheim-123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Identischer Code und identische Message: keine Unterscheidung
    // "E-Mail unbekannt" vs. "Passwort falsch" nach außen.
    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it('session endpoint recognizes a valid session', async () => {
    const registered = await registerUser();
    const cookie = extractSessionCookie(registered);
    const expected = registered.body as AuthSessionDto;

    const response = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
  });

  it('session endpoint rejects missing or invalid sessions', async () => {
    const withoutCookie = await request(app.getHttpServer()).get(
      '/api/auth/session',
    );
    expect(withoutCookie.status).toBe(401);
    expect(withoutCookie.body.code).toBe('AUTHENTICATION_REQUIRED');

    const garbage = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', 'city_session=nicht-existierendes-token');
    expect(garbage.status).toBe(401);
    expect(garbage.body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('expired sessions are rejected and removed', async () => {
    const registered = await registerUser();
    const cookie = extractSessionCookie(registered);
    const token = cookie.slice('city_session='.length);

    await prisma.session.update({
      where: { id: token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', cookie);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SESSION_EXPIRED');
    // Lazy cleanup: die abgelaufene Session ist serverseitig entfernt.
    expect(await prisma.session.count()).toBe(0);
  });

  it('logout invalidates the session server-side and clears the cookie', async () => {
    const registered = await registerUser();
    const cookie = extractSessionCookie(registered);

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie);
    expect(logoutResponse.status).toBe(204);
    expect(await prisma.session.count()).toBe(0);

    const afterLogout = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);

    // Logout ohne Session bleibt idempotent erfolgreich.
    const secondLogout = await request(app.getHttpServer()).post(
      '/api/auth/logout',
    );
    expect(secondLogout.status).toBe(204);
  });
});
