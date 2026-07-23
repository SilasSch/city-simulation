# city-simulation

Technisches Fundament für eine persistente, Sims-artige Multiplayer-Stadt.
Aktueller Stand: **erster fachlicher Vertical Slice** — Session-Authentifizierung
und Character-Verwaltung (erstellen, auflisten, auswählen, dauerhaft laden).
Noch keine Spielwelt.

## Stack

- **Monorepo:** Nx + pnpm + TypeScript (strict)
- **Client:** Angular (Signals) + Phaser (nur technische Grenze, kein Gameplay)
- **Server:** NestJS (modularer Monolith), REST + Socket.IO
- **Datenhaltung:** PostgreSQL + Prisma (Docker Compose)
- **Auth:** serverseitige Sessions (PostgreSQL), Argon2id-Passwort-Hashing,
  HTTP-only Cookie (ADR 0007)
- **Protokoll:** Zod-Schemas in `libs/game-protocol` (Client und Server teilen sie)
- **Tests:** Vitest (Unit, Integration gegen echte Testdatenbank, WebSocket,
  Angular, Phaser-Boot)

## Schnellstart

Voraussetzungen: Node 24, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # PostgreSQL via Docker Compose
pnpm db:migrate     # Prisma-Migrationen anwenden
pnpm dev            # Client (4200) + Server (3000) parallel
```

Danach: http://localhost:4200 — registrieren, Character anlegen (der erste
wird automatisch ausgewählt), weitere Characters verwalten. Die Statusansicht
zeigt REST-Health, WebSocket-Status (verbunden nur mit gültiger Session) und
die letzte Protokollmeldung.

## Befehle

| Befehl            | Zweck                                                            |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm dev`        | Client + Server gemeinsam starten (Nx, parallel)                 |
| `pnpm build`      | Alle Projekte bauen                                              |
| `pnpm lint`       | Alle Projekte linten (inkl. Modulgrenzen)                        |
| `pnpm test`       | Alle Tests ausführen                                             |
| `pnpm format`     | Prettier auf dem gesamten Repo                                   |
| `pnpm db:up`      | PostgreSQL starten                                               |
| `pnpm db:down`    | PostgreSQL stoppen                                               |
| `pnpm db:migrate` | Prisma-Migrationen anwenden                                      |
| `pnpm db:reset`   | Datenbank zurücksetzen + Migrationen neu anwenden (Development!) |

## Struktur

```text
apps/
  client/            # Angular + Phaser (Auth, Charaktere, Status, Engine-Host)
  server/            # NestJS modularer Monolith
    src/auth/        # User Accounts, Sessions, Argon2id, Cookie, Guard
    src/character/   # Character-Use-Cases (erstellen/auflisten/auswählen/laden)
    src/core/        # validierte Konfiguration
    src/health/      # REST-Health
    src/realtime/    # Socket.IO-Gateway (session-authentifiziert)
    src/persistence/ # PrismaService (einziger DB-Zugang)
    src/shared/      # Exception-Filter, ApplicationError
libs/
  shared-types/      # Reine TypeScript-DTOs (frameworkfrei, keine Deps)
  game-protocol/     # Zod-Schemas, Protokollhülle, REST-Verträge, Fehlercodes
docs/
  architecture/      # Architekturüberblick
  decisions/         # ADRs 0001–0009
  development/       # Getting Started
```

## API-Überblick

| Methode | Pfad                         | Zweck                                                        |
| ------- | ---------------------------- | ------------------------------------------------------------ |
| POST    | `/api/auth/register`         | Registrieren (erzeugt User + PlayerProfile, startet Session) |
| POST    | `/api/auth/login`            | Anmelden (neue Session)                                      |
| POST    | `/api/auth/logout`           | Abmelden (Session serverseitig invalidieren)                 |
| GET     | `/api/auth/session`          | Aktuelle Session abfragen                                    |
| POST    | `/api/characters`            | Character erstellen (erster wird auto-ausgewählt)            |
| GET     | `/api/characters`            | Eigene Characters auflisten                                  |
| POST    | `/api/characters/:id/select` | Eigenen Character auswählen                                  |
| GET     | `/api/characters/selected`   | Aktuell ausgewählten Character laden                         |
| GET     | `/api/health`                | Technischer Health-Check                                     |

Alle Character- und Session-Endpunkte erfordern eine gültige Session
(HTTP-only Cookie). Fehler haben stabile maschinenlesbare Codes
(`AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `SESSION_EXPIRED`,
`EMAIL_ALREADY_TAKEN`, `CHARACTER_NAME_INVALID`, `CHARACTER_NOT_FOUND`,
`CHARACTER_NOT_OWNED`, `NO_CHARACTER_SELECTED`, …).

WebSocket (`protocol`-Kanal): der Handshake erfordert ebenfalls eine gültige
Session; unauthentifizierte Verbindungen werden abgelehnt (ADR 0007).

## Was bewusst NICHT enthalten ist

Keine Spielwelt: keine Zonen, keine Bewegung, kein World State, keine
Simulation, keine LLM-Anbindung, keine NPCs. Phaser zeigt nur den technischen
Boot-Status. Fachliche Erweiterungen folgen der Architektur in
`docs/architecture/overview.md` und den ADRs in `docs/decisions/`.
