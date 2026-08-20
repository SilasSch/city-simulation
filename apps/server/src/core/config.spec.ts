import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from './configure-application';
import { validateEnv } from './config';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://city:city@localhost:5432/city_simulation_test',
};

describe('validateEnv CLIENT_ORIGIN', () => {
  it('uses the local client origin by default', () => {
    expect(validateEnv(BASE_ENV).CLIENT_ORIGIN).toBe('http://localhost:4200');
  });

  it('canonicalizes scheme, host, default port, and trailing slash', () => {
    const config = validateEnv({
      ...BASE_ENV,
      CLIENT_ORIGIN: 'HTTPS://Example.COM:443/',
    });

    expect(config.CLIENT_ORIGIN).toBe('https://example.com');
  });

  it.each([
    'ftp://example.com',
    'https://user:secret@example.com',
    'https://example.com/client',
    'https://example.com?tenant=city',
    'https://example.com/#fragment',
  ])('rejects values that are not an HTTP origin: %s', (clientOrigin) => {
    expect(() =>
      validateEnv({ ...BASE_ENV, CLIENT_ORIGIN: clientOrigin }),
    ).toThrow(/CLIENT_ORIGIN/);
  });

  it('validates the simulation speed bounds', () => {
    expect(
      validateEnv({ ...BASE_ENV, SIMULATION_SPEED: '120' }).SIMULATION_SPEED,
    ).toBe(120);
    expect(() => validateEnv({ ...BASE_ENV, SIMULATION_SPEED: '0' })).toThrow(
      /SIMULATION_SPEED/,
    );
  });

  it('requires secure session cookies in production', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://city.example',
        SESSION_COOKIE_SECURE: 'false',
        TRUST_PROXY_HOPS: '1',
      }),
    ).toThrow(/SESSION_COOKIE_SECURE/);

    expect(
      validateEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://city.example',
        SESSION_COOKIE_SECURE: 'true',
        TRUST_PROXY_HOPS: '1',
      }).SESSION_COOKIE_SECURE,
    ).toBe(true);
  });

  it('requires an explicit trusted-proxy boundary in production', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://city.example',
        SESSION_COOKIE_SECURE: 'true',
      }),
    ).toThrow(/TRUST_PROXY_HOPS/);

    expect(
      validateEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://city.example',
        SESSION_COOKIE_SECURE: 'true',
        TRUST_PROXY_HOPS: '1',
      }).TRUST_PROXY_HOPS,
    ).toBe(1);
  });

  it('requires an explicit client origin in production', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        SESSION_COOKIE_SECURE: 'true',
        TRUST_PROXY_HOPS: '1',
      }),
    ).toThrow(/CLIENT_ORIGIN/);
  });

  it('enables HSTS only for production responses', () => {
    expect(buildSecurityHeaders(false)['Strict-Transport-Security']).toBe(
      undefined,
    );
    expect(buildSecurityHeaders(true)['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });
});
