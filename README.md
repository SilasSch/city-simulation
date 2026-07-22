# city-simulation

Technisches Fundament für eine persistente, Sims-artige Multiplayer-Stadt.
Aktueller Stand: **Initial-Setup ohne Gameplay-Features** — Monorepo, Client,
Server, gemeinsames Netzwerkprotokoll, Datenbankanbindung, Tests und CI.

## Stack

- **Monorepo:** Nx + pnpm + TypeScript (strict)
- **Client:** Angular (Signals) + Phaser (nur technische Grenze, kein Gameplay)
- **Server:** NestJS (modularer Monolith), REST + Socket.IO
- **Datenhaltung:** PostgreSQL + Prisma (Docker Compose)
- **Protokoll:** Zod-Schemas in `libs/game-protocol` (Client und Server teilen sie)
- **Tests:** Vitest (Unit, Integration, WebSocket, Angular, Phaser-Boot)

## Schnellstart

Voraussetzungen: Node 24, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # PostgreSQL via Docker Compose
pnpm db:migrate     # Prisma-Migrationen (aktuell: leeres Schema, Verbindungsnachweis)
pnpm dev            # Client (4200) + Server (3000) parallel
```

Danach: http://localhost:4200 — die Statusansicht zeigt REST-Health,
WebSocket-Status und die letzte Protokollmeldung.

## Befehle

| Befehl            | Zweck                                            |
| ----------------- | ------------------------------------------------ |
| `pnpm dev`        | Client + Server gemeinsam starten (Nx, parallel) |
| `pnpm build`      | Alle Projekte bauen                              |
| `pnpm lint`       | Alle Projekte linten (inkl. Modulgrenzen)        |
| `pnpm test`       | Alle Tests ausführen                             |
| `pnpm format`     | Prettier auf dem gesamten Repo                   |
| `pnpm db:up`      | PostgreSQL starten                               |
| `pnpm db:down`    | PostgreSQL stoppen                               |
| `pnpm db:migrate` | Prisma-Migrationen anwenden                      |

## Struktur

```text
apps/
  client/            # Angular + Phaser (Statusansicht, Engine-Host)
  server/            # NestJS modularer Monolith
libs/
  shared-types/      # Reine TypeScript-Typen (frameworkfrei, keine Deps)
  game-protocol/     # Zod-Schemas, Protokollhülle, Parsing, Fehlercodes
docs/
  architecture/      # Architekturüberblick
  decisions/         # ADRs 0001–0006
  development/       # Getting Started
```

## Was bewusst NICHT enthalten ist

Keine Gameplay-Features: keine Auth, keine Charaktere, keine Weltkarte, keine
Simulation, keine LLM-Anbindung, keine Spielerbewegung. Fachliche Module und
Tabellen werden erst mit konkreten Features ergänzt — entlang der Architektur
in `docs/architecture/overview.md` und den ADRs in `docs/decisions/`.
