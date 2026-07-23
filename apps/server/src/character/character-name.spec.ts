import { describe, expect, it } from 'vitest';
import { ApplicationError } from '../shared/application-error';
import {
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_NAME_MIN_LENGTH,
  validateCharacterName,
} from './character-name';

describe('validateCharacterName (domain rules)', () => {
  it('trims surrounding whitespace', () => {
    expect(validateCharacterName('  Ayla  ')).toBe('Ayla');
  });

  it('accepts names at the length boundaries', () => {
    expect(validateCharacterName('ab')).toBe('ab');
    expect(validateCharacterName('x'.repeat(CHARACTER_NAME_MAX_LENGTH))).toBe(
      'x'.repeat(CHARACTER_NAME_MAX_LENGTH),
    );
  });

  it('rejects empty and whitespace-only names', () => {
    expect(() => validateCharacterName('')).toThrow(ApplicationError);
    expect(() => validateCharacterName('   ')).toThrow(ApplicationError);
  });

  it('rejects too short and too long names', () => {
    expect(() => validateCharacterName('a')).toThrow(ApplicationError);
    expect(() =>
      validateCharacterName('x'.repeat(CHARACTER_NAME_MAX_LENGTH + 1)),
    ).toThrow(ApplicationError);
  });

  it('fails with the stable CHARACTER_NAME_INVALID code', () => {
    try {
      validateCharacterName(' ');
      expect.unreachable('muss werfen');
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError);
      expect((error as ApplicationError).code).toBe('CHARACTER_NAME_INVALID');
    }
  });

  it('documents the boundaries used by the rule', () => {
    expect(CHARACTER_NAME_MIN_LENGTH).toBe(2);
    expect(CHARACTER_NAME_MAX_LENGTH).toBe(32);
  });
});
