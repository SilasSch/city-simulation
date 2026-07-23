import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthSessionDto } from '@city/shared-types';
import { AuthService } from './auth.service';
import { AuthViewComponent } from './auth-view.component';

const SESSION: AuthSessionDto = {
  userId: '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e',
  playerProfileId: '7a8b9c0d-1e2f-4a4b-9c6d-7e8f9a0b1c2d',
  email: 'player@example.com',
};

describe('AuthViewComponent', () => {
  let fixture: ComponentFixture<AuthViewComponent>;
  let authStub: {
    session: ReturnType<typeof signal<AuthSessionDto | null>>;
    state: ReturnType<typeof signal<'unknown' | 'anonymous' | 'authenticated'>>;
    login: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };

  function createComponent(
    state: 'unknown' | 'anonymous' | 'authenticated',
  ): void {
    authStub = {
      session: signal(state === 'authenticated' ? SESSION : null),
      state: signal(state),
      login: vi.fn().mockReturnValue(of(SESSION)),
      register: vi.fn().mockReturnValue(of(SESSION)),
      logout: vi.fn().mockReturnValue(of({})),
    };

    TestBed.configureTestingModule({
      imports: [AuthViewComponent],
      providers: [{ provide: AuthService, useValue: authStub }],
    });

    fixture = TestBed.createComponent(AuthViewComponent);
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

  function setInput(selector: string, value: string): void {
    const input = query<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submitForm(): void {
    query<HTMLFormElement>('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('shows the login state of an authenticated session', () => {
    createComponent('authenticated');

    expect(
      el().querySelector('[data-testid="session-info"]')?.textContent,
    ).toContain('player@example.com');
    expect(el().querySelector('[data-testid="logout-button"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="email-input"]')).toBeNull();
  });

  it('shows the login form when anonymous', () => {
    createComponent('anonymous');

    expect(el().querySelector('[data-testid="email-input"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="password-input"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="session-info"]')).toBeNull();
  });

  it('keeps the submit button disabled for invalid input and enables it for valid input', () => {
    createComponent('anonymous');

    const submit = query<HTMLButtonElement>('[data-testid="submit-button"]');
    expect(submit.disabled).toBe(true);

    setInput('[data-testid="email-input"]', 'player@example.com');
    setInput('[data-testid="password-input"]', 'geheim-123');

    expect(submit.disabled).toBe(false);
  });

  it('calls login with the entered credentials on submit', () => {
    createComponent('anonymous');

    setInput('[data-testid="email-input"]', 'player@example.com');
    setInput('[data-testid="password-input"]', 'geheim-123');
    submitForm();

    expect(authStub.login).toHaveBeenCalledWith(
      'player@example.com',
      'geheim-123',
    );
  });

  it('shows an understandable error message on failed login', () => {
    createComponent('anonymous');
    authStub.login.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: { code: 'INVALID_CREDENTIALS' },
          }),
      ),
    );

    setInput('[data-testid="email-input"]', 'player@example.com');
    setInput('[data-testid="password-input"]', 'geheim-123');
    submitForm();

    const error = el().querySelector('[data-testid="auth-error"]');
    expect(error?.textContent).toContain('E-Mail oder Passwort ist falsch');
  });
});
