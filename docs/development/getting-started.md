# Getting Started

## Voraussetzungen

- Node.js 24 (`node --version`)
- pnpm 11 (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker + Docker Compose

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
   (ADR 0009). Weitere Characters anlegen und per Klick auswählen.
3. **Statusansicht:** REST-Health `ok (Datenbank: up)`, WebSocket `connected`
   (nur mit gültiger Session), Phaser-Status `gestartet`.
4. **Reload / Server-Neustart:** Session und Charakterauswahl bleiben
   erhalten (serverseitig persistiert).
5. **Abmelden:** Session wird serverseitig invalidiert, der WebSocket
   getrennt; Character-Anfragen werden danach mit `401
AUTHENTICATION_REQUIRED` abgelehnt.

## Häufige Fehler

| Symptom                                                         | Ursache / Lösung                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Invalid server configuration: DATABASE_URL …` beim Serverstart | `.env` fehlt → `cp .env.example .env`                                                                |
| `Can't reach database server` / Health zeigt `database: down`   | PostgreSQL läuft nicht → `pnpm db:up`                                                                |
| Port 3000/4200 belegt                                           | Anderen Prozess beenden oder `SERVER_PORT` in `.env` ändern                                          |
| `pnpm install` meldet ignorierte Build-Skripte                  | In `pnpm-workspace.yaml` sind `allowBuilds`/`onlyBuiltDependencies` gepflegt — nicht einfach löschen |
| WebSocket zeigt `error`                                         | Keine gültige Session — erst anmelden (der Handshake wird sonst abgelehnt, ADR 0007)                 |
| Character-Anfragen: `401 SESSION_EXPIRED`                       | Session abgelaufen (`SESSION_TTL_HOURS`) — erneut anmelden                                           |
| Cookie wird nicht gesendet                                      | Immer über den Dev-Proxy (Port 4200) arbeiten, nicht direkt über Port 3000 aufrufen                  |

## Tägliche Arbeit

```bash
pnpm dev                 # beide Apps im Watch-Modus
pnpm test                # Vitest über alle Projekte
pnpm lint                # ESLint inkl. Nx-Modulgrenzen
pnpm build               # Produktiv-Builds (client → dist/apps/client, server → dist/apps/server)
pnpm format              # Prettier
pnpm db:reset            # Development-DB leeren + alle Migrationen neu anwenden
```

Einzelnes Projekt: `pnpm exec nx run server:test`, `pnpm exec nx run client:build` usw.
Projektgraph: `pnpm exec nx graph`

### Tests und Datenbanken

Server-Integrationstests laufen gegen eine eigene Testdatenbank
(`city_simulation_test`), die beim Teststart automatisch angelegt und
migriert wird (`apps/server/test/global-setup.ts`). Die Development-
Datenbank bleibt davon unberührt. Voraussetzung: der PostgreSQL-Container
läuft (`pnpm db:up`).

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
8. **Transport-Wahl:** fachliche Abfragen/Kommandos zunächst über REST;
   WebSocket-Nachrichten nur für echte Echtzeit (World/Präsenz, später).
9. Tests sind Teil des Features: Schema-Tests für neue Verträge,
   Service-/Integrations-Tests für Server-Logik (echte Testdatenbank),
   Komponententests für UI.
10. `pnpm lint && pnpm test && pnpm build` müssen vor dem Push grün sein —
    die CI prüft exakt das (plus Migration gegen echtes PostgreSQL).

## Umgebungsvariablen

Siehe `.env.example`. Der Server validiert sie beim Start mit Zod
(`apps/server/src/core/config.ts`) und verweigert bei Fehlern den Start.

| Variable                | Standard                | Zweck                                          |
| ----------------------- | ----------------------- | ---------------------------------------------- |
| `DATABASE_URL`          | – (Pflicht)             | PostgreSQL-Verbindung                          |
| `SERVER_PORT`           | `3000`                  | HTTP-Port des Servers                          |
| `CLIENT_ORIGIN`         | `http://localhost:4200` | Erlaubter Origin (CORS)                        |
| `SESSION_TTL_HOURS`     | `24`                    | Session-Lebensdauer in Stunden (fester Ablauf) |
| `SESSION_COOKIE_SECURE` | `false`                 | Secure-Flag des Session-Cookies (Prod: `true`) |
