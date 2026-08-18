import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import type { AuthSessionDto, CharacterDto } from '@city/shared-types';
import { AppModule } from '../app.module';
import { AuthRateLimiter } from '../auth/rate-limit.guard';
import { configureApplication } from '../core/configure-application';
import { PrismaService } from '../persistence/prisma.service';
import { cleanDatabase } from '../../test/test-database';

const CLIENT_ORIGIN = 'http://localhost:4200';

/**
 * Integrationstests des Character-Vertical-Slice gegen die echte
 * Testdatenbank: Besitzerprüfungen, Auto-Auswahl des ersten Characters,
 * dauerhafte Auswahl über einen Server-Neustart hinweg und der
 * Besitzer-Fremdschlüssel auf Datenbankebene.
 */
describe('Character (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rateLimiter: AuthRateLimiter;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    rateLimiter = app.get(AuthRateLimiter);
  });

  beforeEach(async () => {
    rateLimiter.clear();
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const instance = moduleRef.createNestApplication();
    configureApplication(instance);
    await instance.init();
    return instance;
  }

  interface TestUser {
    cookie: string;
    session: AuthSessionDto;
  }

  async function registerAndGetCookie(
    target: INestApplication,
    email: string,
  ): Promise<TestUser> {
    const response = await request(target.getHttpServer())
      .post('/api/auth/register')
      .set('Origin', CLIENT_ORIGIN)
      .send({ email, password: 'geheim-123' });
    expect(response.status).toBe(201);
    const setCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const sessionCookie = (cookies as string[]).find((c) =>
      c.startsWith('city_session='),
    );
    if (!sessionCookie) throw new Error('Kein Session-Cookie erhalten');
    return {
      cookie: sessionCookie.split(';')[0],
      session: response.body as AuthSessionDto,
    };
  }

  async function createCharacter(
    user: TestUser,
    name: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/characters')
      .set('Origin', CLIENT_ORIGIN)
      .set('Cookie', user.cookie)
      .send({ name });
  }

  it('creates a character for the authenticated player and auto-selects the first one', async () => {
    const user = await registerAndGetCookie(app, 'one@example.com');

    const created = await createCharacter(user, '  Ayla  ');
    expect(created.status).toBe(201);
    const character = created.body as CharacterDto;
    expect(character.name).toBe('Ayla'); // getrimmt
    expect(character.id).toBeDefined();
    expect(character.createdAt).toBeDefined();

    // Besitzerzuordnung in der Datenbank, nicht vom Client bestimmt.
    const stored = await prisma.character.findUnique({
      where: { id: character.id },
    });
    expect(stored?.playerProfileId).toBe(user.session.playerProfileId);

    // ADR 0009: der erste Character ist automatisch ausgewählt.
    const selected = await request(app.getHttpServer())
      .get('/api/characters/selected')
      .set('Cookie', user.cookie);
    expect(selected.status).toBe(200);
    expect((selected.body as CharacterDto).id).toBe(character.id);
  });

  it('auto-selects only the first character, not later ones', async () => {
    const user = await registerAndGetCookie(app, 'two@example.com');

    const first = (await createCharacter(user, 'Erster')).body as CharacterDto;
    await createCharacter(user, 'Zweiter');

    const selected = await request(app.getHttpServer())
      .get('/api/characters/selected')
      .set('Cookie', user.cookie);
    expect((selected.body as CharacterDto).id).toBe(first.id);
  });

  it('rejects invalid names with CHARACTER_NAME_INVALID', async () => {
    const user = await registerAndGetCookie(app, 'names@example.com');

    for (const name of ['', '   ', 'x', 'y'.repeat(33)]) {
      const response = await createCharacter(user, name);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('CHARACTER_NAME_INVALID');
    }
  });

  it('lists only the own characters, never those of other players', async () => {
    const userA = await registerAndGetCookie(app, 'a@example.com');
    const userB = await registerAndGetCookie(app, 'b@example.com');

    await createCharacter(userA, 'Aylas-Figur');
    await createCharacter(userA, 'Zweite-Figur');
    await createCharacter(userB, 'B-Figur');

    const listA = await request(app.getHttpServer())
      .get('/api/characters')
      .set('Cookie', userA.cookie);
    expect(listA.status).toBe(200);
    const charactersA = listA.body as CharacterDto[];
    expect(charactersA).toHaveLength(2);
    expect(charactersA.map((c) => c.name)).toEqual([
      'Aylas-Figur',
      'Zweite-Figur',
    ]);

    const listB = await request(app.getHttpServer())
      .get('/api/characters')
      .set('Cookie', userB.cookie);
    const charactersB = listB.body as CharacterDto[];
    expect(charactersB).toHaveLength(1);
    expect(charactersB[0].name).toBe('B-Figur');
    // Kein fremder Character in der Liste enthalten.
    expect(
      charactersB.some((c) => charactersA.map((a) => a.id).includes(c.id)),
    ).toBe(false);
  });

  it('selects an own character', async () => {
    const user = await registerAndGetCookie(app, 'select@example.com');
    await createCharacter(user, 'Erster');
    const second = (await createCharacter(user, 'Zweiter'))
      .body as CharacterDto;

    const response = await request(app.getHttpServer())
      .post(`/api/characters/${second.id}/select`)
      .set('Origin', CLIENT_ORIGIN)
      .set('Cookie', user.cookie);
    expect(response.status).toBe(200);
    expect((response.body as CharacterDto).id).toBe(second.id);

    const selected = await request(app.getHttpServer())
      .get('/api/characters/selected')
      .set('Cookie', user.cookie);
    expect((selected.body as CharacterDto).id).toBe(second.id);
  });

  it('rejects selecting a character owned by another player', async () => {
    const userA = await registerAndGetCookie(app, 'owner@example.com');
    const userB = await registerAndGetCookie(app, 'intruder@example.com');
    const foreign = (await createCharacter(userA, 'Fremd'))
      .body as CharacterDto;

    const response = await request(app.getHttpServer())
      .post(`/api/characters/${foreign.id}/select`)
      .set('Origin', CLIENT_ORIGIN)
      .set('Cookie', userB.cookie);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CHARACTER_NOT_OWNED');
  });

  it('rejects selecting a nonexistent character', async () => {
    const user = await registerAndGetCookie(app, 'missing@example.com');

    const response = await request(app.getHttpServer())
      .post('/api/characters/9b3c7f7e-2f0a-4c1a-9d7c-6f1a2b3c4d5e/select')
      .set('Origin', CLIENT_ORIGIN)
      .set('Cookie', user.cookie);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CHARACTER_NOT_FOUND');

    const malformed = await request(app.getHttpServer())
      .post('/api/characters/keine-uuid/select')
      .set('Origin', CLIENT_ORIGIN)
      .set('Cookie', user.cookie);
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('VALIDATION_ERROR');
  });

  it('fails with NO_CHARACTER_SELECTED when nothing is selected', async () => {
    const user = await registerAndGetCookie(app, 'empty@example.com');

    const response = await request(app.getHttpServer())
      .get('/api/characters/selected')
      .set('Cookie', user.cookie);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NO_CHARACTER_SELECTED');
  });

  it('rejects character requests without a session', async () => {
    const response = await request(app.getHttpServer()).get('/api/characters');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('enforces ownership of the selected character at database level', async () => {
    const userA = await registerAndGetCookie(app, 'fk-a@example.com');
    const userB = await registerAndGetCookie(app, 'fk-b@example.com');
    const foreign = (await createCharacter(userA, 'FK-Fremd'))
      .body as CharacterDto;

    // Direkter DB-Zugriff, um die Anwendungslogik zu umgehen: der
    // zusammengesetzte Fremdschlüssel muss das Setzen eines fremden
    // Characters verhindern.
    await expect(
      prisma.playerProfile.update({
        where: { id: userB.session.playerProfileId },
        data: { selectedCharacterId: foreign.id },
      }),
    ).rejects.toThrow();
  });

  it('keeps the selected character across a server restart', async () => {
    const user = await registerAndGetCookie(app, 'restart@example.com');
    await createCharacter(user, 'Erster');
    const second = (await createCharacter(user, 'Zweiter'))
      .body as CharacterDto;
    await request(app.getHttpServer())
      .post(`/api/characters/${second.id}/select`)
      .set('Origin', CLIENT_ORIGIN)
      .set('Cookie', user.cookie);

    // Neustart simulieren: komplett neue Nest-Anwendung auf derselben
    // Datenbank, neue Session per Login.
    await app.close();
    app = await createApp();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', CLIENT_ORIGIN)
      .send({ email: 'restart@example.com', password: 'geheim-123' });
    expect(login.status).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const cookie = (cookies as string[])
      .find((c) => c.startsWith('city_session='))
      ?.split(';')[0];

    const selected = await request(app.getHttpServer())
      .get('/api/characters/selected')
      .set('Cookie', cookie as string);
    expect(selected.status).toBe(200);
    expect((selected.body as CharacterDto).id).toBe(second.id);
  });
});
