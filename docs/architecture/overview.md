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
┌────────────┐   REST /api/*    ┌─────────────────────────────┐
│            │ ◄──────────────► │                             │
│   client   │  (Session-Cookie)│   server (NestJS-Monolith)  │
│  Angular   │                  │                             │
│  + Phaser  │   Socket.IO      │   auth · character · core   │
│            │ ◄──────────────► │   health · realtime         │
└────────────┘  Kanal: protocol │   persistence · shared      │
                 (Handshake mit └──────────────┬──────────────┘
                  Session-Prüfung)             │ PrismaService
                                        ┌──────▼──────┐
                                        │ PostgreSQL  │
                                        │ User·Session│
                                        │ PlayerProfile│
                                        │ Character   │
                                        └─────────────┘

libs/shared-types   → reine TS-DTOs (Health, AuthSession, Character), keine Deps
libs/game-protocol  → Zod-Schemas, Protokollhülle, REST-Verträge, Fehlercodes
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
Auswahl am PlayerProfile, Weltbezug (später) am Character. Der ausgewählte
Character wird über einen zusammengesetzten Fremdschlüssel auf
Datenbankebene gezwungen, demselben Profil zu gehören (Details: ADR 0008).

## Server-Module (`apps/server/src`)

| Modul         | Verantwortung                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `auth`        | Registrierung/Login/Logout/Session, Argon2id-Hashing, Session-Cookie, `SessionAuthGuard`, `AuthenticatedPrincipal` |
| `character`   | Use Cases Create/List/Select/GetSelected, Namensdomäne, Character-Repository                                       |
| `core`        | Zod-validierte Konfiguration (fail fast beim Start)                                                                |
| `health`      | REST-Health-Endpunkt (`GET /api/health`), prüft Server + Datenbank                                                 |
| `realtime`    | Socket.IO-Gateway (Transport) + Message-Service; Handshake-Auth-Middleware                                         |
| `persistence` | `PrismaService` als einziger DB-Zugang, global bereitgestellt                                                      |
| `shared`      | Globaler HTTP-Exception-Filter + `ApplicationError` (stabile Fehlercodes)                                          |

Schichtenregeln:

- Controller und Gateways enthalten **keine Geschäftslogik** — sie validieren
  (Transport) und delegieren an Services (Anwendung).
- Datenbankzugriff erfolgt **ausschließlich** über `PrismaService` (direkt in
  Application Services oder über kleine konkrete Repositories wie in
  `character`), niemals aus Controllern, Gateways, Guards oder Interceptors.
- Neue fachliche Module werden als eigene Ordner neben den bestehenden angelegt
  — erst wenn ein konkretes Feature sie benötigt.

## Authentifizierung und Session (ADR 0007)

- REST: `POST /api/auth/register` (erzeugt User + PlayerProfile in einer
  Transaktion, startet Session), `POST /api/auth/login`,
  `POST /api/auth/logout` (idempotent), `GET /api/auth/session`.
- Passwörter: Argon2id (m=19 MiB, t=2, p=1), niemals Klartext, niemals in Logs.
- Session: DB-Zeile mit opaquem 256-Bit-Token, festem Ablauf
  (`SESSION_TTL_HOURS`), lazy cleanup beim Zugriff. Transport als
  HTTP-only-Cookie `city_session` (`SameSite=Lax`, `Secure` konfigurierbar).
- Geschützte Endpunkte laufen über `SessionAuthGuard`; Controller erhalten
  das `AuthenticatedPrincipal` per `@CurrentPrincipal()`. Vom Client
  mitgesendete User-/Profil-IDs werden ignoriert.
- WebSocket: eine Socket.IO-Middleware prüft das Cookie beim Handshake;
  **Verbindungen ohne gültige Session werden abgelehnt**. Das Principal wird
  am Socket hinterlegt und in Logs geführt (User-ID, niemals das Token).

## Netzwerkprotokoll (`libs/game-protocol`)

**Transportstrategie dieser Iteration:** Auth und sämtliche
Character-Operationen laufen über **REST**; die zugehörigen Zod-Schemas und
Fehlercodes liegen trotzdem gemeinsam in `game-protocol`, damit Client und
Server denselben Vertrag validieren. WebSocket-Nachrichten für
Character-CRUD werden bewusst NICHT definiert — der `protocol`-Kanal ist für
künftige World-/Realtime-Kommunikation reserviert (Join, Snapshot, Präsenz).
Erst wenn eine Operation tatsächlich Echtzeit braucht, bekommt sie eine
versionierte WS-Nachricht.

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

Aktuelle technische Nachrichten (bewusst kein Gameplay):

| Richtung      | type                     | Bedeutung                  |
| ------------- | ------------------------ | -------------------------- |
| Client→Server | `connect`                | ConnectCommand             |
| Server→Client | `connection-established` | ConnectionEstablishedEvent |
| Server→Client | `protocol-error`         | ProtocolErrorEvent         |

Fehlercodes (stabil, maschinenlesbar; REST und WS konsistent):

- Technisch: `UNSUPPORTED_PROTOCOL_VERSION`, `INVALID_MESSAGE`,
  `VALIDATION_ERROR`, `PERSISTENCE_ERROR`, `UNEXPECTED_ERROR`
- Auth: `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `SESSION_EXPIRED`,
  `EMAIL_ALREADY_TAKEN`
- Character: `CHARACTER_NAME_INVALID`, `CHARACTER_NOT_FOUND`,
  `CHARACTER_NOT_OWNED`, `NO_CHARACTER_SELECTED`

## Client (`apps/client`)

- `AuthService` — Session-Zustand als Signals (`state`, `session`); Methoden
  für register/login/logout/refresh. Liest niemals das Cookie.
- `AuthViewComponent` — technische Oberfläche für Registrierung, Login,
  Logout, Session-Anzeige.
- `CharacterService` — Character-Liste und Auswahl als Signals; validiert
  Antworten mit den gemeinsamen Zod-Schemas, lädt nach Mutationen neu
  (Auto-Auswahl rät der Client nicht selbst).
- `CharacterViewComponent` — Liste, Anlage-Formular (UI-Validierung nur als
  Komfort; verbindlich ist der Server), Auswahl, Anzeige des Gewählten.
- `StatusViewComponent` — zeigt REST-Health, WebSocket-Status und die letzte
  Protokollmeldung an (nur Anzeige).
- `App` — prüft beim Start die Session; verbindet den WebSocket erst bei
  `authenticated` und trennt bei Logout (inkl. Aufräumen des Character-Zustands).
- `RealtimeService` — einziger WebSocket-Zugang; sendet validierte Commands,
  validiert eingehende Events, bildet Fehlerzustände als Signals ab.
- `GameHostComponent` + `GameEngineService` — Phaser-Grenze: Engine startet
  außerhalb der Angular-Zone, Boot-Scene liefert nur den technischen
  Startnachweis. Der ausgewählte Character wird noch nicht gerendert.

Angular ist für Shell und UI zuständig, Phaser später für die Spielwelt.
Geschäftslogik hat in Komponenten nichts zu suchen.

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
- Strukturierte Logs für: `user-registered`, `user-logged-in`,
  `user-login-failed` (neutraler Grund), `session-expired`,
  `user-logged-out`, `character-created`, `character-selected`,
  `character-ownership-violation`, WS-Connect/Disconnect (mit userId).
- **Niemals geloggt werden:** Passwörter, Passwort-Hashes, Session-Tokens,
  vollständige Cookies, sensible Request-Bodies.
- WebSocket-Abweisungen werden strukturiert geloggt (Event, Code, requestId,
  socketId) und als `ProtocolErrorEvent` beantwortet.

## Tests

| Test                                                               | Projekt       |
| ------------------------------------------------------------------ | ------------- |
| Zod-Schemas + `parseIncomingMessage` (frameworkfrei)               | game-protocol |
| REST-Verträge (Auth/Character) + Fehlercode-Liste                  | game-protocol |
| Health-Endpunkt 200/503 (Integration, Prisma gemockt)              | server        |
| Auth-Integration: Registrierung, Login, Session, Ablauf, Logout    | server        |
| Argon2id-Hasher (Format, Roundtrip, Fehlverhalten)                 | server        |
| Character-Integration: CRUD, Auto-Auswahl, Besitz, DB-FK, Neustart | server        |
| Character-Namensdomäne (Trimmen, Grenzen, Fehlercode)              | server        |
| WebSocket: Protokoll + Handshake-Ablehnung ohne/gültiger Session   | server        |
| Angular: Status-, Auth- und Character-Ansicht                      | client        |
| Phaser: Engine bootet (HEADLESS) und wird zerstört                 | client        |

Server-Integrationstests laufen gegen eine echte, isolierte
PostgreSQL-Testdatenbank (`city_simulation_test`, vorbereitet durch
`apps/server/test/global-setup.ts`: Datenbank anlegen, `migrate deploy`).
Tabellen werden zwischen den Tests getruncated; Dateien laufen seriell.
