import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Options } from '@node-rs/argon2';

// Argon2id hat in der const enum der Bibliothek den Wert 2. Die enum ist
// "ambient const" und daher mit isolatedModules nicht per Namen
// referenzierbar — der PHC-Präfix im Test beweist den Algorithmus.
const ARGON2ID = 2;

// OWASP-Empfehlung für Argon2id: m=19 MiB, t=2, p=1.
const HASH_OPTIONS: Options = {
  algorithm: ARGON2ID as Options['algorithm'],
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Einzige Stelle, die Passwörter hasht oder prüft (Argon2id, OWASP-
 * Empfehlung m=19 MiB / t=2 / p=1). Salz wird von der Bibliothek zufällig
 * erzeugt und im PHC-String gespeichert. Passwörter werden niemals im
 * Klartext gespeichert oder geloggt (ADR 0007).
 */
@Injectable()
export class PasswordHasherService {
  async hash(plainPassword: string): Promise<string> {
    return hash(plainPassword, HASH_OPTIONS);
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plainPassword);
    } catch {
      // Ungültiges Hash-Format o. ä. zählt als fehlgeschlagene Prüfung,
      // nicht als Systemfehler.
      return false;
    }
  }
}
