import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { AuthSessionDto } from '@city/shared-types';
import { authSessionSchema } from '@city/game-protocol';

export type AuthState = 'unknown' | 'anonymous' | 'authenticated';

/**
 * Clientseitiger Session-Zustand. Das Session-Cookie selbst bleibt
 * HTTP-only und wird niemals ausgelesen — der Zustand kommt ausschließlich
 * aus den validierten REST-Antworten des Servers.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly session = signal<AuthSessionDto | null>(null);
  readonly state = signal<AuthState>('unknown');

  /** Einmalig beim App-Start: besteht bereits eine gültige Session? */
  refreshSession(): void {
    this.http.get<unknown>('/api/auth/session').subscribe({
      next: (raw) => {
        this.session.set(authSessionSchema.parse(raw));
        this.state.set('authenticated');
      },
      error: () => {
        this.session.set(null);
        this.state.set('anonymous');
      },
    });
  }

  register(email: string, password: string): Observable<AuthSessionDto> {
    return this.http
      .post<unknown>('/api/auth/register', { email, password })
      .pipe(
        map((raw) => authSessionSchema.parse(raw)),
        tap((session) => this.applySession(session)),
      );
  }

  login(email: string, password: string): Observable<AuthSessionDto> {
    return this.http.post<unknown>('/api/auth/login', { email, password }).pipe(
      map((raw) => authSessionSchema.parse(raw)),
      tap((session) => this.applySession(session)),
    );
  }

  logout(): Observable<unknown> {
    return this.http.post<unknown>('/api/auth/logout', {}).pipe(
      tap(() => {
        this.session.set(null);
        this.state.set('anonymous');
      }),
    );
  }

  private applySession(raw: AuthSessionDto): void {
    this.session.set(raw);
    this.state.set('authenticated');
  }
}
