import { describe, expect, it } from 'vitest';
import { PROTOCOL_ERROR_CODES, protocolErrorCodeSchema } from './protocol';
import {
  authSessionSchema,
  characterDtoSchema,
  characterIdParamSchema,
  characterListSchema,
  createCharacterRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
} from './rest';

describe('REST auth schemas', () => {
  it('accepts a valid register request and normalizes the email', () => {
    const result = registerRequestSchema.parse({
      email: '  Player@Example.COM ',
      password: 'geheim-123',
    });
    expect(result.email).toBe('player@example.com');
    expect(result.password).toBe('geheim-123');
  });

  it('rejects invalid register requests', () => {
    expect(
      registerRequestSchema.safeParse({
        email: 'keine-email',
        password: 'geheim-123',
      }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        email: 'a@example.com',
        password: 'kurz',
      }).success,
    ).toBe(false);
  });

  it('accepts any non-empty password at login (no policy leak)', () => {
    expect(
      loginRequestSchema.safeParse({
        email: 'a@example.com',
        password: 'x',
      }).success,
    ).toBe(true);
    expect(
      loginRequestSchema.safeParse({
        email: 'a@example.com',
        password: '',
      }).success,
    ).toBe(false);
  });

  it('validates an auth session response', () => {
    const session = {
      userId: '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e',
      playerProfileId: '7a8b9c0d-1e2f-4a4b-9c6d-7e8f9a0b1c2d',
      email: 'player@example.com',
    };
    expect(authSessionSchema.safeParse(session).success).toBe(true);
    expect(
      authSessionSchema.safeParse({ ...session, email: 'kaputt' }).success,
    ).toBe(false);
  });
});

describe('REST character schemas', () => {
  it('accepts a syntactically valid create request', () => {
    expect(
      createCharacterRequestSchema.safeParse({ name: 'Ayla' }).success,
    ).toBe(true);
    // Leere/kurze Namen sind syntaktisch gültig — die fachliche Regel
    // (CHARACTER_NAME_INVALID) entscheidet die Server-Domäne.
    expect(createCharacterRequestSchema.safeParse({ name: '' }).success).toBe(
      true,
    );
    expect(createCharacterRequestSchema.safeParse({ name: 42 }).success).toBe(
      false,
    );
  });

  it('validates character ids as uuid', () => {
    expect(
      characterIdParamSchema.safeParse('3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e')
        .success,
    ).toBe(true);
    expect(characterIdParamSchema.safeParse('keine-uuid').success).toBe(false);
  });

  it('validates character DTOs and lists', () => {
    const character = {
      id: '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e',
      name: 'Ayla',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(characterDtoSchema.safeParse(character).success).toBe(true);
    expect(characterListSchema.safeParse([character]).success).toBe(true);
    expect(
      characterDtoSchema.safeParse({ ...character, id: 'kaputt' }).success,
    ).toBe(false);
  });
});

describe('protocol error codes', () => {
  it('includes the stable domain error codes', () => {
    for (const code of [
      'AUTHENTICATION_REQUIRED',
      'INVALID_CREDENTIALS',
      'RATE_LIMITED',
      'SESSION_EXPIRED',
      'ORIGIN_NOT_ALLOWED',
      'EMAIL_ALREADY_TAKEN',
      'CHARACTER_NAME_INVALID',
      'CHARACTER_NOT_FOUND',
      'CHARACTER_NOT_OWNED',
      'NO_CHARACTER_SELECTED',
      'WORLD_NOT_ENTERED',
    ]) {
      expect(PROTOCOL_ERROR_CODES).toContain(code);
      expect(protocolErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });
});
