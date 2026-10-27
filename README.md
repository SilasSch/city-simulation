# city-simulation

Technisches Fundament für eine persistente, Sims-artige Multiplayer-Stadt.
Aktueller Stand: **durchgängiger Multiplayer-Spiel-Loop** — gehärtete
Session-Authentifizierung, Character-Verwaltung, eine kollisionsbehaftete Karte,
Live-Präsenz sowie persistente Simulationszeit, Energie und Interaktionen.

## Stack

- **Toolchain:** Node.js 24 (`>=24 <25`), pnpm **11.21.0**, Nx und
  TypeScript (strict)
- **Client:** Angular Signals + Three.js; die Engine rendert bestätigten World
  State und sendet Bewegungs-Commands
- **Server:** NestJS als modularer Monolith, REST + Socket.IO
- **Datenhaltung:** PostgreSQL + Prisma (Docker Compose)
- **Auth:** serverseitige Sessions, Argon2id, HTTP-only Cookie, Origin-Schutz
  und route-spezifisches Rate-Limiting (ADR 0007)
- **Protokoll:** gemeinsame Zod-Schemas in `libs/game-protocol`
- **Tests:** Vitest, echte PostgreSQL-Integrationstests, WebSocket-Tests und
  ein Playwright-End-to-End-Smoke-Test

## Schnellstart

Voraussetzungen: Node.js 24, pnpm 11.21.0 und Docker. Die Versionen sind
in `package.json` festgelegt.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # PostgreSQL via Docker Compose
pnpm db:migrate     # Prisma-Migrationen anwenden
pnpm dev            # Client (4200) + Server (3000) parallel
```

Danach: <http://localhost:4200> — registrieren, Character anlegen (der
erste wird automatisch ausgewählt) und die Zone **Central Square** betreten.
WASD oder Pfeiltasten senden validierte Bewegungs-Commands; erst das
Serverevent bewegt die Figur in der 3D-Szene. Gebäude und Brunnen blockieren Bewegung.
An der südlichen Bank kann der Character rasten und Energie regenerieren.
Position, Auswahl, Energie, Simulationszeit und Session werden wiederhergestellt.

## Staging-/Produktionsbetrieb mit Docker Compose

Der Produktions-Stack baut Client und Server in Multi-Stage-Images, hält
PostgreSQL ausschließlich in einem internen Docker-Netz und veröffentlicht nur
den Nginx-Reverse-Proxy. REST, Socket.IO und die Angular-SPA sind dadurch über
dieselbe Origin erreichbar. Vor jedem Serverstart führt ein einmaliger
`migrate`-Container `prisma migrate deploy` aus; der Server startet nur nach
erfolgreichen Migrationen und einem positiven Datenbank-Healthcheck.

```bash
cp .env.production.example .env.production
# POSTGRES_PASSWORD und CLIENT_ORIGIN in .env.production sicher setzen
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl --fail https://staging.city.example.com/api/health
```

Das benannte Volume `postgres-production-data` überlebt Container-Neustarts
und Rebuilds. `docker compose down` behält es ebenfalls; **`down --volumes`**
löscht dagegen Accounts, Characters, Sessions und World-Positionen endgültig.
Die echte `.env.production` darf nicht committed werden (das Repository nimmt
nur die Platzhalterdatei auf).

Der Stack terminiert TLS mit Caddy und veröffentlicht ausschließlich Ports 80
und 443. Die vollständige, auf einen einzelnen Staging-Server zugeschnittene
Anleitung einschließlich DNS/TLS, Erstinstallation, Updates, Backups,
Wiederherstellung und Rollback steht in
[`docs/deployment/single-server-staging.md`](docs/deployment/single-server-staging.md).

`CLIENT_ORIGIN=https://…` muss exakt der öffentlichen Origin entsprechen, damit
Secure-Session-Cookies, REST-Origin-Schutz und WebSocket-Allowlist
übereinstimmen. Echte Zugangsdaten bleiben ausschließlich in der ignorierten
`.env.production` auf dem Server.

## Befehle

| Befehl              | Zweck                                                            |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | Client + Server gemeinsam starten (Nx, parallel)                 |
| `pnpm build`        | Alle Projekte bauen                                              |
| `pnpm lint`         | Alle Projekte linten (inkl. Modulgrenzen)                        |
| `pnpm test`         | Unit- und Integrationstests aller Projekte                       |
| `pnpm e2e`          | Playwright-Smoke-Test gegen isolierte E2E-Datenbank              |
| `pnpm format`       | Prettier auf dem gesamten Repo anwenden                          |
| `pnpm format:check` | Formatierung ohne Änderungen prüfen                              |
| `pnpm db:up`        | PostgreSQL starten                                               |
| `pnpm db:down`      | PostgreSQL stoppen                                               |
| `pnpm db:migrate`   | Prisma-Migrationen anwenden                                      |
| `pnpm db:reset`     | Datenbank zurücksetzen + Migrationen neu anwenden (Development!) |

## Struktur

```text
apps/
  client/            # Angular-Shell, World-State-Projektion und Three.js-Szene
  client-e2e/        # Playwright-Smoke-Test + isolierter Server-/DB-Start
  server/            # NestJS modularer Monolith
    src/auth/        # Accounts, Sessions, Argon2id, Rate-Limit, Cleanup
    src/character/   # Character-Use-Cases und Auswahl
    src/core/        # Konfiguration, Origin-/CSRF-Schutz, Security-Header
    src/health/      # REST-Health
    src/realtime/    # validierter Socket.IO-Transport
    src/world/       # Eintritt, Präsenz, Kollision und Bewegung
    src/simulation/  # persistente Uhr, Energie und Interaktionen
    src/persistence/ # PrismaService (einziger DB-Zugang)
    src/shared/      # Exception-Filter, ApplicationError
libs/
  shared-types/      # Reine TypeScript-DTOs
  game-protocol/     # Zod-Schemas für REST- und WS-Verträge
docs/
  architecture/      # Architekturüberblick
  decisions/         # ADRs 0001–0015
  development/       # Getting Started
  plans/             # Abgestimmte Specs für kommende Milestones
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
| DELETE  | `/api/characters/:id`        | Eigenen Character sicher löschen                             |
| POST    | `/api/characters/:id/select` | Eigenen Character auswählen                                  |
| GET     | `/api/characters/selected`   | Aktuell ausgewählten Character laden                         |
| GET     | `/api/health`                | Technischer Health-Check                                     |

Alle Character- und Session-Endpunkte erfordern eine gültige Session im
HTTP-only Cookie. Unsichere REST-Methoden akzeptieren ausschließlich den exakt
konfigurierten `CLIENT_ORIGIN`; CORS verwendet dieselbe Allowlist.

## WebSocket-World-Slice

Alle Nachrichten laufen über den Socket.IO-Kanal `protocol`:

| Richtung      | Typ                      | Bedeutung                                               |
| ------------- | ------------------------ | ------------------------------------------------------- |
| Client→Server | `connect`                | Technischen Protokoll-Handshake abschließen             |
| Client→Server | `world-enter`            | `central-square` betreten                               |
| Server→Client | `world-snapshot`         | Bestätigte Projektion aller Online-Entities laden       |
| Client→Server | `world-move`             | Richtung `N/E/S/W` als Command senden                   |
| Client→Server | `world-interact`         | Interaktion mit einem Weltobjekt starten                |
| Server→Client | `world-position-changed` | Persistierte Position an die Zone broadcasten           |
| Server→Client | `world-entity-joined`    | Ersten Socket eines Characters ankündigen               |
| Server→Client | `world-entity-left`      | Letzten Socket eines Characters abmelden                |
| Server→Client | `world-entity-updated`   | Energie und Interaktionsfortschritt aktualisieren       |
| Server→Client | `simulation-clock`       | Aktuelle Simulationszeit und Geschwindigkeit übertragen |

Der Handshake prüft exakten Origin und Session genau einmal. Danach hält ein
aktives Session-Socket-Register den Command-Pfad datenbankfrei; Logout und Ablauf
trennen alle lokalen Sockets der Session sofort.

## Sicherheitsgrenze

- Registrierung wird pro IP auf 3 Requests pro Minute begrenzt. Login nutzt
  ein grobes IP-Limit (20/min) plus IP-und-normalisierte-E-Mail (5/min). Die
  atomaren Buckets liegen in PostgreSQL und gelten über Server-Replikate hinweg.
- Unbekannte Login-E-Mails durchlaufen eine echte Dummy-Argon2-Prüfung und
  haben keinen billigen Early Return.
- Abgelaufene Sessions werden beim Zugriff, beim Start und alle 15 Minuten
  gelöscht; `Session.expiresAt` ist indiziert.
- Produktion verlangt expliziten `CLIENT_ORIGIN`, `TRUST_PROXY_HOPS` und
  `SESSION_COOKIE_SECURE=true`; andernfalls startet der Server nicht. Der
  Compose-Stack vertraut genau dem einen vorgeschalteten Proxy-Hop.
- REST und WebSocket nutzen dieselbe Origin-Allowlist. Security-Header
  schließen unter anderem Framing, MIME-Sniffing und unnötige Browserrechte
  aus; HSTS wird in Produktion gesetzt.

## Bewusster Umfang

Die Spielwelt bleibt absichtlich eine statische Zone, besitzt nun aber eine
code-native Karte, gemeinsame Collider, Online-Präsenz, eine persistente Uhr,
Energie und einen ersten Bank-Interaktionsloop. Noch nicht enthalten sind
Wirtschaft, NPCs, autonome Agenten oder Microservices. Der Client nutzt keine
optimistische Mutation: Three.js zeigt ausschließlich vom Server bestätigten
Zustand. Details stehen im Architekturüberblick und in ADR 0010–0013.

Der Umbau auf 3D läuft (v0.10–v1.0, Spec in
[`docs/plans/3d-v1.0.md`](docs/plans/3d-v1.0.md)): Three.js rendert die Zonen
bereits als Grey-Box (ADR 0014), und Positionen leben in einem 20-Hz-Zonen-Tick
mit periodischer Persistenz (ADR 0015). Bewegt wird noch schrittweise über
`world-move`; stufenlose Bewegung mit Client-Prediction folgt.
