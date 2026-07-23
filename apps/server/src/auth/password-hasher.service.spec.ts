import { describe, expect, it } from 'vitest';
import { PasswordHasherService } from './password-hasher.service';

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();

  it('hashes passwords as Argon2id PHC string, never in clear text', async () => {
    const hash = await hasher.hash('mein-passwort-123');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('mein-passwort-123');
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hasher.hash('mein-passwort-123');
    expect(await hasher.verify(hash, 'mein-passwort-123')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('mein-passwort-123');
    expect(await hasher.verify(hash, 'anderes-passwort')).toBe(false);
  });

  it('rejects malformed hashes without throwing', async () => {
    expect(await hasher.verify('kein-phc-string', 'passwort')).toBe(false);
  });
});
