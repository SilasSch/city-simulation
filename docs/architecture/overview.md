# Architekturüberblick

## Leitidee

Der Server ist die alleinige Wahrheit über den Weltzustand
(**server-authoritative**, ADR 0003). Clients senden Commands und Queries,
niemals eigene Zustandsänderungen — und niemals eigene Identitätsbehauptungen:
die Benutzeridentität stammt ausschließlich aus der serverseitig validierten
Session (ADR 0007). Alle Daten an Netzwerkgrenzen werden zur Laufzeit mit Zod
validiert (ADR 0004).

Das Backend ist ein **modularer Monolith** (ADR 0002): eine Anwendung, klare
Module, keine Microservices.

## Bausteine

```text
┌─────────────────┐    REST /api/*     ┌──────────────────────────────┐
│ Angular-Shell   │ ◄────────────────► │ NestJS-Monolith              │
│ Signals         │   HTTP-only Cookie │ auth · character · world     │
│                 │                    │ core · health · realtime     │
│ Phaser-Scene    │    Socket.IO       │ persistence · shared         │
│ Central Square  │ ◄────────────────► │                              │
└─────────────────┘  Kanal: protocol   └──────────────┬───────────────┘
      ▲ bestätigte Snapshots/Events                    │ PrismaService
      └───────────────────────────────────────┐        ▼
                                      ┌──────────────────────┐
                                      │ PostgreSQL           │
                                      │ User · Session       │
                                      │ PlayerProfile        │
                                      │ Character            │
                                      │ CharacterWorldState  │
                                      └──────────────────────┘

libs/shared-types   → reine TypeScript-DTOs, keine Abhängigkeiten
libs/game-protocol  → gemeinsame Zod-Verträge für REST und WebSocket
```

## Identitätskette (ADR 0008)

```text
User Account (Login, Sessions, Passwort-Hash)
    1 ─── 1
PlayerProfile (fachliche Spieler-Identität, Besitz, Auswahl)
    1 ─── n
Character (steuerbare Figur: id, playerProfileId, name, Zeitstempel)
```

Die Begriffe werden nicht vermischt: Sessions hängen am User, Besitz und
Auswahl am PlayerProfile, der persistente Weltzustand am Character. Der
ausgewählte Character wird über einen zusammengesetzten Fremdschlüssel auf
Datenbankebene gezwungen, demselben Profil zu gehören (ADR 0008).
`CharacterWorldState` speichert Zone, Position und eine Revisionsnummer
genau einmal pro Character.

## Server-Module (`apps/server/src`)

| Modul         | Verantwortung                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `auth`        | Accounts, Argon2id, Sessions, Cookie, Guards, Rate-Limit und Ablauf-Cleanup                    |
| `character`   | Create/List/Select/GetSelected, Namensdomäne und Besitz                                        |
| `world`       | Eintritt, Snapshot, persistente serverautoritative Bewegung und Revisionskonflikte             |
| `core`        | Zod-Konfiguration, REST-Origin-/CSRF-Guard, CORS, WebSocket-Origin-Adapter und Security-Header |
| `health`      | `GET /api/health`, prüft Server und Datenbank                                                  |
| `realtime`    | Validierter Socket.IO-Transport, Session-Revalidierung, Räume und Broadcasts                   |
| `persistence` | Globaler `PrismaService` als einziger DB-Zugang                                                |
| `shared`      | HTTP-Exception-Filter und `ApplicationError` mit stabilen Fehlercodes                          |

Schichtenregeln:

- Controller und Gateways enthalten **keine Geschäftslogik** — sie validieren
  (Transport) und delegieren an Services (Anwendung).
- Datenbankzugriff erfolgt **ausschließlich** über `PrismaService` (direkt in
  Application Services oder über kleine konkrete Repositories wie in
  `character`), niemals aus Controllern, Gateways, Guards oder Interceptors.
- Neue fachliche Module werden als eigene Ordner neben den bestehenden angelegt
  — erst wenn ein konkretes Feature sie benötigt.

## Authentifizierung und Session (ADR 0007)

- REST: `POST /api/auth/register` erzeugt User und PlayerProfile atomar
  und startet eine Session; Login, idempotenter Logout und Session-Restore
  liegen ebenfalls unter `/api/auth`.
- Passwörter: Argon2id (m=19 MiB, t=2, p=1), niemals Klartext oder Log-Inhalt.
  Auch eine unbekannte Login-E-Mail führt eine echte Prüfung gegen einen
  statischen Dummy-Argon2-Hash aus; es gibt keinen billigen Early Return.
- Register und Login haben getrennte IP-basierte Fixed-Window-Limits vor
  Argon2: 3 beziehungsweise 5 Requests pro 60 Sekunden. Der stabile Fehler ist
  `RATE_LIMITED` (429). Der In-Memory-Store ist für eine Serverinstanz gedacht;
  mehrere Replikate benötigen einen gemeinsamen Store.
- Eine Session ist eine DB-Zeile mit opaquem 256-Bit-Token und festem Ablauf
  (`SESSION_TTL_HOURS`, kein Sliding). Abgelaufene Zeilen werden beim Zugriff,
  beim Anwendungsstart und danach alle 15 Minuten gelöscht; `expiresAt` ist
  indiziert und der Wartungstimer hält den Prozess nicht offen.
- Das Cookie `city_session` ist `HttpOnly`, `SameSite=Lax`, `Path=/`.
  In Produktion sind expliziter `CLIENT_ORIGIN` und
  `SESSION_COOKIE_SECURE=true` Pflicht; ungültige Konfiguration verhindert
  den Start.
- `SessionAuthGuard` und `@CurrentPrincipal()` liefern die Identität.
  User-, Profil- oder Character-IDs aus nicht dafür vorgesehenen Clientdaten
  werden nicht als Identitätsbehauptung akzeptiert.
- Unsichere REST-Methoden müssen exakt vom `CLIENT_ORIGIN` stammen
  (CSRF-/Origin-Guard). Credentialed CORS, Socket.IO-Polling und der echte
  WebSocket-Handshake verwenden dieselbe exakte Allowlist; fehlende, opake oder
  fremde Origins werden an den schreibenden Grenzen abgelehnt.
- Basis-Header setzen restriktive CSP, Permissions- und Referrer-Policy,
  `nosniff`, Frame-Schutz und entfernen `X-Powered-By`; Produktion ergänzt
  HSTS.
- WebSocket: Handshake und Cookie müssen gültig sein. Vor jedem Protokoll-
  Command wird die Session erneut aus PostgreSQL aufgelöst. Logout oder Ablauf
  erzeugen einen stabilen Fehler und trennen auch bereits verbundene Sockets.

## Netzwerkprotokoll (`libs/game-protocol`)

**Transportstrategie:** Auth und Character-Verwaltung laufen über REST.
Die Spielwelt nutzt den versionierten Socket.IO-Kanal `protocol`: Eintritt und
Bewegung sind Commands, Snapshot und Positionsänderung sind Serverevents.
Character-CRUD bleibt bewusst außerhalb des Echtzeitprotokolls. Sämtliche
Requests, Commands und Events werden an beiden Netzwerkgrenzen mit den
gemeinsamen Zod-Schemas validiert.

REST-Verträge (alle Antworten als DTOs, keine Prisma-Modelle):

| Methode | Pfad                         | Request-Schema                 | Antwort                       |
| ------- | ---------------------------- | ------------------------------ | ----------------------------- |
| POST    | `/api/auth/register`         | `registerRequestSchema`        | 201 `AuthSessionDto` + Cookie |
| POST    | `/api/auth/login`            | `loginRequestSchema`           | 200 `AuthSessionDto` + Cookie |
| POST    | `/api/auth/logout`           | –                              | 204, Cookie gelöscht          |
| GET     | `/api/auth/session`          | –                              | 200 `AuthSessionDto` / 401    |
| POST    | `/api/characters`            | `createCharacterRequestSchema` | 201 `CharacterDto`            |
| GET     | `/api/characters`            | –                              | 200 `CharacterDto[]`          |
| POST    | `/api/characters/:id/select` | `characterIdParamSchema`       | 200 `CharacterDto`            |
| GET     | `/api/characters/selected`   | –                              | 200 `CharacterDto` / 404      |

Der erste erstellte Character eines Profils wird in derselben Transaktion
automatisch ausgewählt (ADR 0009); die Auswahl überlebt Server-Neustarts
(persistierte `selectedCharacterId`).

## Minimaler World-Slice (ADR 0010)

- Es gibt exakt eine statische Zone: `central-square`.
- Ein `world-enter` erfordert einen aktuell ausgewählten Character. Beim
  ersten Eintritt wird er bei (50, 50) angelegt; Wiedereintritt und Reconnect
  behalten die persistierte Position.
- Der Snapshot enthält die eigene Character-ID und alle gespeicherten Entities
  der Zone.
- `world-move` enthält nur `N`, `E`, `S` oder `W`. Der Server bewegt in
  Fünferschritten, begrenzt Koordinaten auf 0–100, persistiert und broadcastet
  erst danach `world-position-changed` in den Zonenraum.
- Eine Revisionsnummer mit Compare-and-Update serialisiert konkurrierende
  Bewegungen. Nach einem Character-Wechsel ist der alte Eintrittskontext
  ungültig und muss neu aufgebaut werden.
- Der Client führt keine optimistische Positionsänderung aus. Er leert stale
  State bei Verbindungs-/Auswahlwechseln, fordert einen neuen Snapshot an und
  projiziert ausschließlich bestätigte Serverevents in Angular und Phaser.

WebSocket-Nachrichten laufen über **einen** Socket.IO-Kanal (`protocol`) mit
einheitlicher, versionierter Hülle:

```typescript
{ version: 1, type: 'connect', requestId?: '<uuid>', timestamp: '<iso>', payload: { … } }
```

- `PROTOCOL_VERSION` ist zentral in `game-protocol` definiert; Client und
  Server verwenden dieselbe Konstante.
- Eingehende Rohdaten durchlaufen `parseIncomingMessage`:
  1. Hüllen-Validierung (`protocolEnvelopeSchema`)
  2. Versionsprüfung
  3. typ-spezifische Payload-Validierung
- Abgelehnte Nachrichten erzeugen ein `ProtocolErrorEvent` mit stabilem
  maschinenlesbarem Code und der ursprünglichen `requestId`, falls vorhanden.
- Bei nicht unterstützter Version bleibt die Verbindung offen (ADR 0006).

Aktuelle Nachrichten:

| Richtung      | `type`                   | Bedeutung                                      |
| ------------- | ------------------------ | ---------------------------------------------- |
| Client→Server | `connect`                | Technische Verbindung initialisieren           |
| Server→Client | `connection-established` | Verbindung mit ID bestätigen                   |
| Client→Server | `world-enter`            | Statische Zone betreten                        |
| Server→Client | `world-snapshot`         | Vollständige bestätigte Zonenprojektion        |
| Client→Server | `world-move`             | Validierte Bewegungsrichtung anfordern         |
| Server→Client | `world-position-changed` | Persistierte Entity-Position broadcasten       |
| Server→Client | `protocol-error`         | Technischen oder fachlichen Fehler übermitteln |

Fehlercodes (stabil, maschinenlesbar; REST und WS konsistent):

- Technisch: `UNSUPPORTED_PROTOCOL_VERSION`, `INVALID_MESSAGE`,
  `VALIDATION_ERROR`, `PERSISTENCE_ERROR`, `UNEXPECTED_ERROR`
- Auth/Sicherheit: `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`,
  `RATE_LIMITED`, `SESSION_EXPIRED`, `ORIGIN_NOT_ALLOWED`,
  `EMAIL_ALREADY_TAKEN`
- Character/World: `CHARACTER_NAME_INVALID`, `CHARACTER_NOT_FOUND`,
  `CHARACTER_NOT_OWNED`, `NO_CHARACTER_SELECTED`, `WORLD_NOT_ENTERED`

## Client (`apps/client`)

- `AuthService` hält Session-Zustand als Signals und liest niemals das
  HTTP-only Cookie.
- `CharacterService` verwaltet Liste und bestätigte Auswahl; nach Mutationen
  lädt er die Serverprojektion neu.
- `App` stellt beim Start die Session wieder her, verbindet Socket.IO nur
  authentifiziert und räumt bei Logout Character- und Verbindungszustand auf.
- `RealtimeService` ist der einzige Socket-Zugang. Er sendet ausschließlich
  validierte Commands und veröffentlicht ausschließlich validierte Events.
- `WorldStateService` projiziert Snapshot und Positionsevents als Signals.
  Eine neue Connection-ID oder Character-Auswahl leert stale State und sendet
  erneut `world-enter`. `move()` verändert lokal keine Koordinate.
- `GameHostComponent` kapselt Phaser außerhalb der Angular-Zone.
  `GameEngineService` zeichnet Central Square und Entity-Marker, bildet
  WASD/Pfeiltasten auf Richtungs-Commands ab und ignoriert Key-Repeat.
- Auth-, Character- und Status-Komponenten bleiben dünne UI-Adapter.

Angular besitzt Shell und reaktiven Zustand; Phaser rendert die Weltprojektion.
Weder Komponenten noch Scene treffen fachliche Bewegungsentscheidungen.

## Modulgrenzen

ESLint (`@nx/enforce-module-boundaries`) erzwingt:

- `scope:client` und `scope:server` dürfen nur `scope:shared` importieren.
- `scope:shared` darf nur `scope:shared` importieren.

Damit ist sichergestellt, dass Client und Server ausschließlich über die
gemeinsamen Libraries gekoppelt sind. `game-protocol` importiert keine
Frameworks (Angular, NestJS, Prisma, Socket.IO); `shared-types` hat keine
Abhängigkeiten. Character-Domänencode hängt nicht an HTTP, Cookies oder
Sockets; Auth-Transportdetails sickern nicht in Fachlogik (nur das
`AuthenticatedPrincipal` wird weitergereicht).

## Fehlerbehandlung und Logging

- Kontrollierte fachliche Fehler sind `ApplicationError`s (stabiler Code +
  HTTP-Status); der globale Filter übersetzt sie 1:1 in die öffentliche
  Fehlerstruktur (`statusCode`, `code`, `message`, `timestamp`, `path`).
  Unerwartete Fehler: voller Stack ins Log, generische 500 nach außen.
  Keine Stacktraces, Pfade oder DB-Details nach außen.
- Strukturierte Logs erfassen unter anderem Registrierung/Login, Session-
  Ablauf und Cleanup, Character-Erstellung/-Auswahl, World-Eintritt/-Bewegung
  sowie WS-Connect/Disconnect und Nachrichtenablehnung (mit IDs, nie Tokens).
- **Niemals geloggt werden:** Passwörter, Passwort-Hashes, Session-Tokens,
  vollständige Cookies, sensible Request-Bodies.
- WebSocket-Abweisungen werden strukturiert geloggt (Event, Code, requestId,
  socketId) und als `ProtocolErrorEvent` beantwortet.

## Reproduzierbare Toolchain und CI

`package.json` pinnt `pnpm@11.21.0` und Node `>=24 <25`.
`pnpm-workspace.yaml` erlaubt nur die benötigten Dependency-Builds. Der
CI-Job `verify` verwendet dieselben Major-/Patch-Versionen und führt nach
Frozen-Lockfile-Installation und Migration in dieser Reihenfolge aus:

1. Prisma-Client generieren
2. `pnpm format:check`
3. `pnpm lint`
4. `pnpm test`
5. Chromium installieren und `pnpm e2e`
6. `pnpm build`

## Tests

| Abdeckung                                                                     | Projekt       |
| ----------------------------------------------------------------------------- | ------------- |
| REST-/WS-Zod-Schemas, Parser, World-Bounds und stabile Fehlercodes            | game-protocol |
| Config-Fail-fast, Origin/CORS/CSRF und Security-Header                        | server        |
| Auth: Argon2id + Dummy-Pfad, beide Rate-Limits, Session/Lifecycle/Cleanup     | server        |
| Character: CRUD, Auto-Auswahl, Besitz, zusammengesetzter DB-FK und Persistenz | server        |
| World: Spawn, Snapshot, Re-Enter, Grenzen, Konkurrenz und Auswahlwechsel      | server        |
| WebSocket: Origin/Session, Revalidierung, Protokoll, World-Events/Broadcast   | server        |
| Angular: Auth, Character, Reconnect und World-State ohne Optimismus           | client        |
| Phaser: Tastaturmapping, HEADLESS-Boot und sauberer Shutdown                  | client        |
| Browser-Smoke: Register → Character → Auswahl → Reload/WS → Logout            | client-e2e    |

Server-Integrationstests laufen seriell gegen
`city_simulation_test`; der globale Testaufbau legt sie an und wendet echte
Migrationen an. Playwright verwendet separat `city_simulation_e2e`, migriert
und leert sie vor dem Smoke-Test und verweigert aus Sicherheitsgründen einen
abweichenden Datenbanknamen. Die Development-Datenbank
`city_simulation` bleibt von beiden Testarten unberührt.
