import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const APP_ORIGIN = 'http://localhost:4200';

test.describe.configure({ mode: 'serial' });

test('registers, restores the selected character and websocket, then logs out', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8);
  const email = `smoke-${runId}@example.test`;
  const password = `smoke-pass-${runId}`;
  const firstCharacter = `Ayla-${runId}`;
  const selectedCharacter = `Borin-${runId}`;

  const createCharacter = async (name: string): Promise<void> => {
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/characters',
    );
    const listRefreshed = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/characters',
    );
    const selectionRefreshed = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/characters/selected',
    );

    await page.getByTestId('name-input').fill(name);
    await page.getByTestId('create-button').click();

    const [createdResponse, listResponse, selectionResponse] =
      await Promise.all([created, listRefreshed, selectionRefreshed]);
    expect(createdResponse.status()).toBe(201);
    expect(listResponse.status()).toBe(200);
    expect(selectionResponse.status()).toBe(200);
  };

  await page.goto('/');

  await expect(page.getByTestId('email-input')).toBeVisible();
  await page.getByTestId('toggle-mode').click();
  await expect(page.getByTestId('submit-button')).toHaveText('Registrieren');

  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);

  const registration = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/register',
  );
  const initialCharacterList = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/characters',
  );
  const initialSelection = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/characters/selected',
  );
  await page.getByTestId('submit-button').click();

  expect((await registration).status()).toBe(201);
  expect((await initialCharacterList).status()).toBe(200);
  expect((await initialSelection).status()).toBe(404);

  await expect(page.getByTestId('session-info')).toContainText(email);
  await expect(page.getByTestId('ws-state')).toHaveText('connected');
  await expect(page.getByTestId('last-message')).toHaveText(
    'connection-established',
  );

  await createCharacter(firstCharacter);
  await expect(page.getByTestId('selected-character')).toContainText(
    firstCharacter,
  );

  await createCharacter(selectedCharacter);

  const selectedCharacterRow = page
    .getByTestId('character-list')
    .getByRole('listitem')
    .filter({ hasText: selectedCharacter });
  await expect(selectedCharacterRow).toBeVisible();

  const selection = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/select'),
  );
  await selectedCharacterRow.getByRole('button', { name: 'Auswählen' }).click();
  expect((await selection).status()).toBe(200);
  await expect(page.getByTestId('selected-character')).toContainText(
    selectedCharacter,
  );

  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'city_session',
  );
  if (!sessionCookie) throw new Error('Session cookie was not set');
  expect(sessionCookie.httpOnly).toBe(true);

  await page.reload();

  await expect(page.getByTestId('session-info')).toContainText(email);
  await expect(page.getByTestId('selected-character')).toContainText(
    selectedCharacter,
  );
  await expect(page.getByTestId('ws-state')).toHaveText('connected');
  await expect(page.getByTestId('world-zone')).toContainText('central-square');
  await expect(page.getByTestId('last-message')).toHaveText('world-snapshot');

  const logout = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/logout',
  );
  await page.getByTestId('logout-button').click();
  expect((await logout).status()).toBe(204);

  await expect(page.getByTestId('ws-state')).toHaveText('disconnected');
  await expect(page.getByTestId('email-input')).toBeVisible();
  await expect(page.getByTestId('character-list')).toHaveCount(0);
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'city_session',
      ),
    )
    .toBe(false);

  const staleSession = await request.get(`${APP_ORIGIN}/api/auth/session`, {
    headers: {
      cookie: `city_session=${sessionCookie.value}`,
      origin: APP_ORIGIN,
    },
  });
  expect(staleSession.status()).toBe(401);

  await page.reload();
  await expect(page.getByTestId('email-input')).toBeVisible();
  await expect(page.getByTestId('ws-state')).toHaveText('disconnected');
});
