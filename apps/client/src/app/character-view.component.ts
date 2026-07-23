import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CharacterService } from './character.service';
import { extractErrorCode } from './http-error';

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 32;

const ERROR_MESSAGES: Record<string, string> = {
  CHARACTER_NAME_INVALID: `Der Name muss ${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} Zeichen haben.`,
  CHARACTER_NOT_OWNED: 'Dieser Charakter gehört dir nicht.',
  CHARACTER_NOT_FOUND: 'Charakter wurde nicht gefunden.',
  SESSION_EXPIRED: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
  AUTHENTICATION_REQUIRED: 'Bitte erneut anmelden.',
};

/**
 * Technische Character-Oberfläche: Liste, Anlage, Auswahl und Anzeige des
 * ausgewählten Charakters. Enthält keine Fachlogik — Validierung ist hier
 * nur UI-Komfort, die verbindlichen Regeln erzwingt der Server.
 */
@Component({
  selector: 'app-character-view',
  template: `
    <section class="panel">
      <h2>Charaktere</h2>

      @if (characters.selected(); as selected) {
        <p data-testid="selected-character">
          Ausgewählt: <strong>{{ selected.name }}</strong>
        </p>
      } @else {
        <p data-testid="selected-character">Kein Charakter ausgewählt.</p>
      }

      @if (characters.error(); as loadError) {
        <p class="error" data-testid="load-error">{{ loadError }}</p>
      }

      <ul class="character-list" data-testid="character-list">
        @for (character of characters.characters(); track character.id) {
          <li>
            <span>{{ character.name }}</span>
            @if (characters.selected()?.id === character.id) {
              <span data-testid="selected-marker">(ausgewählt)</span>
            } @else {
              <button
                [attr.data-testid]="'select-' + character.id"
                (click)="select(character.id)"
              >
                Auswählen
              </button>
            }
          </li>
        } @empty {
          <li data-testid="empty-list">Noch keine Charaktere angelegt.</li>
        }
      </ul>

      <form (submit)="create($event)">
        <label>
          Neuer Charaktername
          <input
            data-testid="name-input"
            [value]="name()"
            (input)="onNameInput($event)"
          />
        </label>
        @if (nameTouched() && !nameValid()) {
          <p class="error" data-testid="name-hint">
            Der Name muss {{ NAME_MIN_LENGTH }}–{{ NAME_MAX_LENGTH }} Zeichen
            haben (Außenräume zählen nicht).
          </p>
        }
        @if (errorMessage(); as message) {
          <p class="error" data-testid="create-error">{{ message }}</p>
        }
        <button
          type="submit"
          data-testid="create-button"
          [disabled]="!nameValid() || busy()"
        >
          Charakter erstellen
        </button>
      </form>
    </section>
  `,
})
export class CharacterViewComponent implements OnInit {
  protected readonly characters = inject(CharacterService);

  protected readonly NAME_MIN_LENGTH = NAME_MIN_LENGTH;
  protected readonly NAME_MAX_LENGTH = NAME_MAX_LENGTH;

  protected readonly name = signal('');
  protected readonly nameTouched = signal(false);
  protected readonly busy = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly nameValid = computed(() => {
    const trimmed = this.name().trim().length;
    return trimmed >= NAME_MIN_LENGTH && trimmed <= NAME_MAX_LENGTH;
  });

  ngOnInit(): void {
    this.characters.loadAll();
  }

  protected onNameInput(event: Event): void {
    this.nameTouched.set(true);
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected create(event: Event): void {
    event.preventDefault();
    if (!this.nameValid() || this.busy()) return;

    this.busy.set(true);
    this.errorMessage.set(null);
    this.characters.create(this.name()).subscribe({
      next: () => {
        this.busy.set(false);
        this.name.set('');
        this.nameTouched.set(false);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.errorMessage.set(this.toMessage(error));
      },
    });
  }

  protected select(id: string): void {
    this.errorMessage.set(null);
    this.characters.select(id).subscribe({
      error: (error: unknown) => this.errorMessage.set(this.toMessage(error)),
    });
  }

  private toMessage(error: unknown): string {
    const code = extractErrorCode(error);
    return (
      (code && ERROR_MESSAGES[code]) ??
      `Aktion fehlgeschlagen${code ? ` (${code})` : ''}.`
    );
  }
}
