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
pnpm db:migrate     # Prisma: Schema-Stand anwenden + Client generieren
pnpm dev            # startet client (4200) und server (3000) parallel
```

Browser öffnen: <http://localhost:4200>

Erwartung in der Statusansicht:

- **REST-Health:** `ok (Datenbank: up)`
- **WebSocket:** `connected` mit Connection-ID
- **Letzte Protokollmeldung:** `connection-established`
- **Phaser-Status:** `gestartet`

## Häufige Fehler

| Symptom                                                         | Ursache / Lösung                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Invalid server configuration: DATABASE_URL …` beim Serverstart | `.env` fehlt → `cp .env.example .env`                                                                |
| `Can't reach database server` / Health zeigt `database: down`   | PostgreSQL läuft nicht → `pnpm db:up`                                                                |
| Port 3000/4200 belegt                                           | Anderen Prozess beenden oder `SERVER_PORT` in `.env` ändern                                          |
| `pnpm install` meldet ignorierte Build-Skripte                  | In `pnpm-workspace.yaml` sind `allowBuilds`/`onlyBuiltDependencies` gepflegt — nicht einfach löschen |

## Tägliche Arbeit

```bash
pnpm dev                 # beide Apps im Watch-Modus
pnpm test                # Vitest über alle Projekte
pnpm lint                # ESLint inkl. Nx-Modulgrenzen
pnpm build               # Produktiv-Builds (client → dist/apps/client, server → dist/apps/server)
pnpm format              # Prettier
```

Einzelnes Projekt: `pnpm exec nx run server:test`, `pnpm exec nx run client:build` usw.
Projektgraph: `pnpm exec nx graph`

## Konventionen für neue Arbeit

1. **Keine fachlichen Module ohne Feature.** Neue Server-Module entstehen als
   eigener Ordner unter `apps/server/src/<name>/` (Module, Transport, Service).
2. **Neue Netzwerkverträge immer in `libs/game-protocol`:** Zod-Schema,
   abgeleiteter Typ, Eintrag im Parser. Typen nie von Hand doppelt pflegen.
3. **Protokollversion** nur mit Migrationsplan erhöhen (siehe ADR 0006).
4. **Controller/Gateways bleiben dumm**, Logik gehört in Services. DB-Zugriff
   nur über `PrismaService`.
5. **Reine Typen ohne Laufzeitbedarf** kommen in `libs/shared-types`.
6. Externe Eingaben werden **immer** mit Zod validiert — auch im Client.
7. Tests sind Teil des Features: Schema-Tests für neue Nachrichten,
   Service-/Gateway-Tests für Server-Logik, Komponententests für UI.
8. `pnpm lint && pnpm test && pnpm build` müssen vor dem Push grün sein —
   die CI prüft exakt das (plus Migration gegen echtes PostgreSQL).

## Umgebungsvariablen

Siehe `.env.example`. Der Server validiert sie beim Start mit Zod
(`apps/server/src/core/config.ts`) und verweigert bei Fehlern den Start.
