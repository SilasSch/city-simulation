import { ApplicationError } from '../shared/application-error';

export const CHARACTER_NAME_MIN_LENGTH = 2;
export const CHARACTER_NAME_MAX_LENGTH = 32;

/**
 * Fachliche Namensregeln für Characters (reine Domäne, kein Framework):
 * außen trimmen, dann Länge prüfen. Charakternamen müssen NICHT global
 * eindeutig sein (ADR 0008) — Eindeutigkeit wäre ein späteres, eigenes
 * Feature und wird bewusst nicht vorweggenommen.
 */
export function validateCharacterName(rawName: string): string {
  const name = rawName.trim();
  if (
    name.length < CHARACTER_NAME_MIN_LENGTH ||
    name.length > CHARACTER_NAME_MAX_LENGTH
  ) {
    throw new ApplicationError(
      'CHARACTER_NAME_INVALID',
      400,
      `Character name must be ${CHARACTER_NAME_MIN_LENGTH}–${CHARACTER_NAME_MAX_LENGTH} characters after trimming`,
    );
  }
  return name;
}
