# Getting Started

## Voraussetzungen

- Node.js 24; `package.json` erlaubt ausschließlich `>=24 <25`
- pnpm **11.21.0**, passend zum `packageManager`-Pin
- Docker + Docker Compose

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
node --version   # v24.x
pnpm --version   # 11.21.0
```

Keine `latest`-Version aktivieren: lokale Entwicklung und CI verwenden
absichtlich dieselbe konkrete pnpm-Version.

## Erster Start

```bash
git clone <repo> && cd city-simulation
pnpm install
cp .env.example .env
pnpm db:up          # PostgreSQL-Container (wartet auf Healthcheck)
pnpm db:migrate     # Prisma: Migrationen anwenden + Client generieren
pnpm dev            # startet client (4200) und server (3000) parallel
```

Browser öffnen: <http://localhost:4200>

Erwartung:

1. **Registrieren** (E-Mail + Passwort ≥ 8 Zeichen) — legt User Account und
   PlayerProfile an und startet sofort eine Session.
2. **Character erstellen** — der erste Character wird automatisch ausgewählt
   (ADR 0009). Weitere Characters können angelegt und ausgewählt werden.
3. **Welt betreten:** Sobald Session, WebSocket und Auswahl bereit sind, sendet
   der Client `world-enter` für `central-square` und rendert den Snapshot.
4. **Bewegen:** WASD oder Pfeiltasten senden Richtungs-Commands. Collider
   blockieren Gebäude, Brunnen und Zonengrenzen serverseitig.
5. **Multiplayer:** Weitere verbundene Characters erscheinen und verschwinden
   über Join-/Leave-Events; mehrere Tabs desselben Characters zählen einmal.
6. **Rasten:** Zur südlichen Bank bewegen und „Rasten“ wählen. Der Server
   bestätigt Start, Fortschritt und Energiegewinn über die Simulationsuhr.
7. **Reload / Reconnect:** Auswahl, Position, Energie und Simulationszeit werden
   wiederhergestellt; eine neue Socket-Verbindung fordert erneut den Snapshot.
8. **Löschen / Abmelden:** Characters lassen sich sicher löschen; eine aktive
   Auswahl wird atomar geleert. Logout invalidiert Cookie und alle Session-Sockets.

## Häufige Fehler

| Symptom                                           | Ursache / Lösung                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Server meldet ungültige `DATABASE_URL`            | `.env` fehlt oder ist ungültig; von `.env.example` ableiten                                            |
| Health meldet `database: down`                    | PostgreSQL-Container und `DATABASE_URL` prüfen                                                         |
| Port 3000/4200 ist belegt                         | Prozess beenden oder `SERVER_PORT` ändern                                                              |
| pnpm meldet ignorierte Build-Skripte              | Nur `allowBuilds` in `pnpm-workspace.yaml` pflegen; keine zweite `onlyBuiltDependencies`-Liste anlegen |
| `ORIGIN_NOT_ALLOWED` bei POST                     | Exakt über `http://localhost:4200` arbeiten; `CLIENT_ORIGIN` muss Scheme, Host und Port entsprechen    |
| WebSocket-Verbindung wird abgelehnt               | Gültige Session **und** exakter Origin sind bereits beim Handshake Pflicht                             |
| `RATE_LIMITED` bei Register/Login                 | Das 60-Sekunden-Fenster abwarten; Buckets gelten gemeinsam über Server-Replikate                       |
| `SESSION_EXPIRED`                                 | Erneut anmelden; abgelaufene Sessionzeilen werden automatisch bereinigt                                |
| Produktionsstart verweigert Cookie-/Origin-Konfig | Expliziten HTTPS-`CLIENT_ORIGIN` und `SESSION_COOKIE_SECURE=true` setzen                               |
| E2E-Start verweigert den Datenbanknamen           | `E2E_DATABASE_URL` muss auf `city_simulation_e2e` zeigen                                               |

## Tägliche Arbeit

```bash
pnpm dev                 # beide Apps im Watch-Modus
pnpm format:check        # Prettier prüfen, ohne Dateien zu ändern
pnpm lint                # ESLint inkl. Nx-Modulgrenzen
pnpm test                # Vitest über alle Projekte
pnpm e2e                 # Playwright-Smoke in Chromium
pnpm build               # Produktiv-Builds
pnpm format              # Prettier anwenden
pnpm db:reset            # nur Development: DB leeren und neu migrieren
```

Einzelnes Projekt: `pnpm exec nx run server:test`, `pnpm exec nx run client:build` usw.
Projektgraph: `pnpm exec nx graph`

Dependency-Updates werden über `renovate.json` gesteuert: nicht-breaking
npm- und GitHub-Actions-Updates werden gruppiert, Major-Updates bleiben
separat und der Lockfile-Wartungslauf ist wöchentlich. Damit Pull Requests
entstehen, muss die Renovate GitHub App einmalig für das Repository aktiviert
werden; die Konfiguration selbst enthält keine Zugangsdaten.

### Tests und Datenbanken

Es gibt drei getrennte Datenbanknamen:

| Zweck                   | Datenbank              | Vorbereitung                                     |
| ----------------------- | ---------------------- | ------------------------------------------------ |
| Lokale Entwicklung      | `city_simulation`      | manuell über die Development-Migrationen         |
| Server-Integrationstest | `city_simulation_test` | Global Setup: anlegen, `migrate deploy`, seriell |
| Playwright E2E          | `city_simulation_e2e`  | anlegen, migrieren und vor dem Smoke-Test leeren |

`pnpm e2e` startet echten Server und Client. Das Startskript akzeptiert über
`E2E_DATABASE_URL` ausschließlich den Namen `city_simulation_e2e`, damit
weder Development- noch Testdatenbank versehentlich geleert werden. Der
Playwright-Smoke deckt Registrierung, zwei Characters, Auswahl,
Reload/Session-Restore, WebSocket-Reconnect, Logout und die serverseitige
Invalidierung des alten Cookies ab. Voraussetzung für beide DB-Testarten ist
ein erreichbares PostgreSQL.

## Konventionen für neue Arbeit

1. **Keine fachlichen Module ohne Feature.** Neue Server-Module entstehen als
   eigener Ordner unter `apps/server/src/<name>/` (Module, Transport, Service).
2. **Neue Netzwerkverträge immer in `libs/game-protocol`:** Zod-Schema,
   abgeleiteter Typ, Eintrag im Parser (WS) bzw. Verwendung in Controller und
   Client-Service (REST). Typen nie von Hand doppelt pflegen.
3. **Protokollversion** nur mit Migrationsplan erhöhen (siehe ADR 0006).
4. **Controller/Gateways bleiben dumm**, Logik gehört in Services. DB-Zugriff
   nur über `PrismaService` (direkt oder über kleine konkrete Repositories).
5. **Reine Typen ohne Laufzeitbedarf** kommen in `libs/shared-types`.
6. Externe Eingaben werden **immer** mit Zod validiert — auch im Client.
7. **Identität kommt aus der Session**, niemals aus Client-Daten: geschützte
   Endpunkte mit `SessionAuthGuard` + `@CurrentPrincipal()`. Passwörter und
   Session-Tokens werden niemals geloggt.
8. **Transport-Wahl:** Auth und Character-CRUD bleiben REST; World-Commands,
   Snapshots und Broadcasts laufen versioniert über WebSocket.
9. **Keine optimistische Weltmutation:** Client und Phaser projizieren nur
   bestätigte Snapshots/Events. Fachliche Bewegung bleibt im `WorldService`.
10. Tests sind Teil des Features: Vertrag, Service/Integration, Client-
    Projektion und bei vollständigen Nutzerflüssen Playwright.
11. Vor dem Push müssen `pnpm format:check`, `pnpm lint`, `pnpm test`,
    `pnpm e2e` und `pnpm build` grün sein; CI führt dieselbe Kette nach
    Migration und Prisma-Generierung aus.

## Umgebungsvariablen

Siehe `.env.example`. Der Server validiert sie beim Start mit Zod
(`apps/server/src/core/config.ts`) und verweigert bei Fehlern den Start.

| Variable                | Standard                | Zweck                                                           |
| ----------------------- | ----------------------- | --------------------------------------------------------------- |
| `NODE_ENV`              | `development`           | `production` aktiviert zusätzliche Startregeln und HSTS         |
| `DATABASE_URL`          | – (Pflicht)             | PostgreSQL-Verbindung                                           |
| `SERVER_PORT`           | `3000`                  | HTTP-Port des Servers                                           |
| `CLIENT_ORIGIN`         | `http://localhost:4200` | Exakter HTTP(S)-Origin; in Produktion explizit erforderlich     |
| `TRUST_PROXY_HOPS`      | `0`                     | Zahl explizit vertrauter Reverse-Proxy-Hops; Produktion Pflicht |
| `SESSION_TTL_HOURS`     | `24`                    | Session-Lebensdauer, fester Ablauf ohne Sliding                 |
| `SIMULATION_SPEED`      | `60`                    | Simulationssekunden pro realer Sekunde                          |
| `SESSION_COOKIE_SECURE` | `false`                 | Lokal HTTP; in Produktion zwingend `true`                       |

## Produktionsanforderungen

- `CLIENT_ORIGIN` enthält nur Scheme, Host und optional Port — keine
  Credentials, Pfade, Query oder Fragmente — und sollte HTTPS verwenden.
- Der Server startet mit `NODE_ENV=production` nur, wenn
  `CLIENT_ORIGIN` und `TRUST_PROXY_HOPS` explizit gesetzt sowie
  `SESSION_COOKIE_SECURE=true` ist. Hinter dem Compose-Caddy ist genau ein
  Proxy-Hop vertrauenswürdig; direkte Internet-Proxys dürfen nicht pauschal
  vertraut werden.
- Credentialed CORS und Socket.IO akzeptieren nur diesen Origin. Unsichere
  REST-Methoden prüfen ihn zusätzlich als CSRF-Schutz; ein Browser-CORS-Header
  allein wäre dafür nicht ausreichend.
- Restriktive CSP, Permissions-/Referrer-Policy, `nosniff`, Frame-Schutz,
  deaktiviertes `X-Powered-By` und in Produktion HSTS werden zentral gesetzt.
- WebSockets prüfen die Session einmal beim Handshake. Das lokale
  Session-Socket-Register trennt bei Logout oder festem Ablauf sofort alle
  zugehörigen Tabs, ohne einen DB-Lookup pro Command.
- Auth-Rate-Limit-Buckets liegen atomar in PostgreSQL. Damit teilen Replikate
  dieselben Grenzen; die korrekte Client-IP hängt an der bewusst gesetzten
  Proxy-Grenze.
