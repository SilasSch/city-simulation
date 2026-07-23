import { z } from 'zod';
import type { AuthSessionDto, CharacterDto } from '@city/shared-types';

/**
 * Zod-Schemas für die REST-Verträge (Auth + Character). Server validiert
 * eingehende Requests damit, der Client validiert Antworten — dieselben
 * Schemas auf beiden Seiten, keine doppelt gepflegten Typen.
 *
 * Die fachlichen Commands/Queries dieser Iteration (Registrierung, Login,
 * Character erstellen/auflisten/auswählen/laden) laufen bewusst über REST.
 * WebSocket-Nachrichten werden dafür nicht definiert: Echtzeit ist für
 * World-Kommunikation reserviert (siehe docs/architecture/overview.md).
 */

// --- Auth (ADR 0007) ---

export const authEmailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerRequestSchema = z.object({
  email: authEmailSchema,
  // Mindestlänge 8 ist die einzige Passwort-Policy dieser Iteration.
  // Max begrenzt den Hashing-Aufwand pro Request (DoS-Schutz).
  password: z.string().min(8).max(128),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: authEmailSchema,
  // Beim Login wird die Policy nicht erneut geprüft — nur nicht-leer.
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authSessionSchema = z.object({
  userId: z.string().uuid(),
  playerProfileId: z.string().uuid(),
  email: z.string().email(),
});

// --- Character (Phase 4B) ---

/**
 * Request-Schema für CreateCharacter. Prüft nur die syntaktische Form —
 * die fachlichen Namensregeln (Trimmen, Länge) leben in der Server-Domäne
 * und erzeugen den stabilen Fehlercode CHARACTER_NAME_INVALID.
 */
export const createCharacterRequestSchema = z.object({
  name: z.string().max(256),
});
export type CreateCharacterRequest = z.infer<
  typeof createCharacterRequestSchema
>;

export const characterIdParamSchema = z.string().uuid();

export const characterDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
});

export const characterListSchema = z.array(characterDtoSchema);

// Compile-Zeit-Drift-Schutz: Schemas und shared-types-DTOs müssen
// übereinstimmen (gleiches Muster wie healthResponseSchema).
const _authSessionDriftCheck: AuthSessionDto = {} as z.infer<
  typeof authSessionSchema
>;
void _authSessionDriftCheck;

const _characterDriftCheck: CharacterDto = {} as z.infer<
  typeof characterDtoSchema
>;
void _characterDriftCheck;
