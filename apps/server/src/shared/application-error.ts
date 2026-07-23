import type { ProtocolErrorCode } from '@city/game-protocol';

/**
 * Kontrollierter fachlicher Fehler aus Application- oder Domain-Schicht.
 * Trägt einen stabilen maschinenlesbaren Code und den HTTP-Status — der
 * globale Exception-Filter übersetzt ihn 1:1 in die öffentliche
 * Fehlerstruktur. Die Message ist Teil des Vertrags und darf nach außen
 * gegeben werden (keine internen Details verwenden!).
 */
export class ApplicationError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = ApplicationError.name;
  }
}
