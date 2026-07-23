import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CharacterDto } from '@city/shared-types';
import { CharacterService } from './character.service';
import { CharacterViewComponent } from './character-view.component';

const CHARACTERS: CharacterDto[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ayla',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Borin',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
];

describe('CharacterViewComponent', () => {
  let fixture: ComponentFixture<CharacterViewComponent>;
  let characterStub: {
    characters: ReturnType<typeof signal<CharacterDto[]>>;
    selected: ReturnType<typeof signal<CharacterDto | null>>;
    loading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    loadAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };

  function createComponent(options?: {
    characters?: CharacterDto[];
    selected?: CharacterDto | null;
    loadError?: string | null;
  }): void {
    characterStub = {
      characters: signal(options?.characters ?? []),
      selected: signal(options?.selected ?? null),
      loading: signal(false),
      error: signal(options?.loadError ?? null),
      loadAll: vi.fn(),
      create: vi.fn().mockReturnValue(of(CHARACTERS[0])),
      select: vi.fn().mockReturnValue(of(CHARACTERS[1])),
    };

    TestBed.configureTestingModule({
      imports: [CharacterViewComponent],
      providers: [{ provide: CharacterService, useValue: characterStub }],
    });

    fixture = TestBed.createComponent(CharacterViewComponent);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement;
  }

  function query<T extends Element>(selector: string): T {
    const found = el().querySelector(selector);
    if (!found) throw new Error(`Element nicht gefunden: ${selector}`);
    return found as T;
  }

  function setName(value: string): void {
    const input = query<HTMLInputElement>('[data-testid="name-input"]');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('shows the character list and the selected character', () => {
    createComponent({ characters: CHARACTERS, selected: CHARACTERS[0] });

    const items = el().querySelectorAll('[data-testid="character-list"] li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Ayla');
    expect(items[1].textContent).toContain('Borin');
    expect(
      el().querySelector('[data-testid="selected-character"]')?.textContent,
    ).toContain('Ayla');
    expect(
      el().querySelector('[data-testid="selected-marker"]'),
    ).not.toBeNull();
  });

  it('shows an empty-state hint without characters', () => {
    createComponent();

    expect(el().querySelector('[data-testid="empty-list"]')).not.toBeNull();
    expect(
      el().querySelector('[data-testid="selected-character"]')?.textContent,
    ).toContain('Kein Charakter ausgewählt');
  });

  it('validates the create form input before enabling the button', () => {
    createComponent();

    const button = query<HTMLButtonElement>('[data-testid="create-button"]');
    expect(button.disabled).toBe(true);

    setName('x');
    expect(button.disabled).toBe(true);
    expect(el().querySelector('[data-testid="name-hint"]')).not.toBeNull();

    setName('Ayla');
    expect(button.disabled).toBe(false);
    expect(el().querySelector('[data-testid="name-hint"]')).toBeNull();
  });

  it('calls create with the entered name on submit', () => {
    createComponent();

    setName('  Ayla  ');
    query<HTMLFormElement>('form').dispatchEvent(new Event('submit'));

    expect(characterStub.create).toHaveBeenCalledWith('  Ayla  ');
  });

  it('updates the visible selected character after selection', () => {
    createComponent({ characters: CHARACTERS, selected: CHARACTERS[0] });
    characterStub.select.mockReturnValue(of(CHARACTERS[1]));

    const button = query<HTMLButtonElement>(
      `[data-testid="select-${CHARACTERS[1].id}"]`,
    );
    // Auswahl löst den Service-Aufruf aus; der Service aktualisiert das
    // selected-Signal (hier simuliert).
    characterStub.select.mockImplementation(() => {
      characterStub.selected.set(CHARACTERS[1]);
      return of(CHARACTERS[1]);
    });
    button.click();
    fixture.detectChanges();

    expect(characterStub.select).toHaveBeenCalledWith(CHARACTERS[1].id);
    expect(
      el().querySelector('[data-testid="selected-character"]')?.textContent,
    ).toContain('Borin');
  });

  it('shows an understandable error when creation fails', () => {
    createComponent();
    characterStub.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'CHARACTER_NAME_INVALID' },
          }),
      ),
    );

    setName('Ayla');
    query<HTMLFormElement>('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(
      el().querySelector('[data-testid="create-error"]')?.textContent,
    ).toContain('Der Name muss 2–32 Zeichen haben');
  });

  it('shows load errors understandably', () => {
    createComponent({
      loadError: 'Charaktere konnten nicht geladen werden (Netzwerkfehler).',
    });

    expect(
      el().querySelector('[data-testid="load-error"]')?.textContent,
    ).toContain('konnten nicht geladen werden');
  });
});
