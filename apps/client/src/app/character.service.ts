import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { CharacterDto } from '@city/shared-types';
import { characterDtoSchema, characterListSchema } from '@city/game-protocol';
import { extractErrorCode } from './http-error';

/**
 * Clientseitiger Character-Zustand. Fachliche Entscheidungen (Besitz,
 * Auto-Auswahl, Namensregeln) trifft ausschließlich der Server — dieser
 * Service lädt und spiegelt nur die validierten Ergebnisse.
 */
@Injectable({ providedIn: 'root' })
export class CharacterService {
  private readonly http = inject(HttpClient);

  readonly characters = signal<CharacterDto[]>([]);
  readonly selected = signal<CharacterDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Lädt Liste und aktuelle Auswahl unabhängig voneinander. */
  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<unknown>('/api/characters').subscribe({
      next: (raw) => {
        this.characters.set(characterListSchema.parse(raw));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(
          `Charaktere konnten nicht geladen werden (${extractErrorCode(error) ?? 'Netzwerkfehler'}).`,
        );
        this.loading.set(false);
      },
    });

    this.http.get<unknown>('/api/characters/selected').subscribe({
      next: (raw) => this.selected.set(characterDtoSchema.parse(raw)),
      error: (error: unknown) => {
        // NO_CHARACTER_SELECTED ist ein normaler Zustand, kein Fehler.
        if (
          error instanceof HttpErrorResponse &&
          error.status === 404 &&
          extractErrorCode(error) === 'NO_CHARACTER_SELECTED'
        ) {
          this.selected.set(null);
          return;
        }
        this.error.set(
          `Ausgewählter Charakter konnte nicht geladen werden (${extractErrorCode(error) ?? 'Netzwerkfehler'}).`,
        );
      },
    });
  }

  create(name: string): Observable<CharacterDto> {
    return this.http.post<unknown>('/api/characters', { name }).pipe(
      map((raw) => characterDtoSchema.parse(raw)),
      // Nach dem Anlegen neu laden: der Server wählt den ersten Character
      // automatisch aus (ADR 0009) — der Client rät das nicht selbst.
      tap(() => this.loadAll()),
    );
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`/api/characters/${id}`)
      .pipe(tap(() => this.loadAll()));
  }

  select(id: string): Observable<CharacterDto> {
    return this.http.post<unknown>(`/api/characters/${id}/select`, {}).pipe(
      map((raw) => characterDtoSchema.parse(raw)),
      tap((character) => this.selected.set(character)),
    );
  }

  /** Räumt den lokalen Zustand auf (z. B. nach Logout). */
  clear(): void {
    this.characters.set([]);
    this.selected.set(null);
    this.error.set(null);
    this.loading.set(false);
  }
}
