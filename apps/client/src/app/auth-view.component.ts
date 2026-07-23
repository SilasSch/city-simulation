import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { extractErrorCode } from './http-error';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-Mail oder Passwort ist falsch.',
  EMAIL_ALREADY_TAKEN: 'Diese E-Mail ist bereits registriert.',
  SESSION_EXPIRED: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
  VALIDATION_ERROR:
    'Eingabe ungültig (gültige E-Mail, Passwort mindestens 8 Zeichen).',
};

/**
 * Technische Auth-Oberfläche: Registrierung, Login, Logout und Anzeige des
 * Session-Status. Enthält keine Fachlogik — nur Formularzustand und
 * Delegation an den AuthService.
 */
@Component({
  selector: 'app-auth-view',
  template: `
    <section class="panel">
      <h2>Konto</h2>

      @if (auth.state() === 'authenticated') {
        <p data-testid="session-info">
          Angemeldet als {{ auth.session()?.email }}
        </p>
        <button data-testid="logout-button" (click)="logout()">Abmelden</button>
        @if (errorMessage(); as message) {
          <p class="error" data-testid="auth-error">{{ message }}</p>
        }
      } @else {
        <form (submit)="submit($event)">
          <label>
            E-Mail
            <input
              type="email"
              data-testid="email-input"
              [value]="email()"
              (input)="email.set($any($event.target).value)"
              autocomplete="email"
            />
          </label>
          <label>
            Passwort
            <input
              type="password"
              data-testid="password-input"
              [value]="password()"
              (input)="password.set($any($event.target).value)"
              [autocomplete]="
                mode() === 'register' ? 'new-password' : 'current-password'
              "
            />
          </label>

          @if (errorMessage(); as message) {
            <p class="error" data-testid="auth-error">{{ message }}</p>
          }

          <div class="actions">
            <button
              type="submit"
              data-testid="submit-button"
              [disabled]="!formValid() || busy()"
            >
              {{ mode() === 'login' ? 'Anmelden' : 'Registrieren' }}
            </button>
            <button
              type="button"
              data-testid="toggle-mode"
              (click)="toggleMode()"
            >
              {{
                mode() === 'login'
                  ? 'Neu hier? Registrieren'
                  : 'Bereits registriert? Anmelden'
              }}
            </button>
          </div>
        </form>
      }
    </section>
  `,
})
export class AuthViewComponent {
  protected readonly auth = inject(AuthService);

  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly formValid = computed(() => {
    const emailOk = this.email().trim().includes('@');
    const password = this.password();
    return this.mode() === 'register'
      ? emailOk && password.length >= 8
      : emailOk && password.length >= 1;
  });

  protected toggleMode(): void {
    this.mode.update((mode) => (mode === 'login' ? 'register' : 'login'));
    this.errorMessage.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.formValid() || this.busy()) return;

    this.busy.set(true);
    this.errorMessage.set(null);

    const request =
      this.mode() === 'login'
        ? this.auth.login(this.email().trim(), this.password())
        : this.auth.register(this.email().trim(), this.password());

    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.password.set('');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const code = extractErrorCode(error);
        this.errorMessage.set(
          (code && ERROR_MESSAGES[code]) ??
            `Aktion fehlgeschlagen${code ? ` (${code})` : ''}.`,
        );
      },
    });
  }

  protected logout(): void {
    this.errorMessage.set(null);
    this.auth.logout().subscribe({
      error: () =>
        this.errorMessage.set(
          'Abmeldung fehlgeschlagen. Bitte erneut versuchen.',
        ),
    });
  }
}
