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
`CharacterWorldState` speichert Zone, Position, Revision, Energie und eine
optionale Interaktion genau einmal pro Character. Wird der ausgewählte Character
gelöscht, leert dieselbe Transaktion zuerst die Auswahl; der restriktive
Fremdschlüssel verhindert jede andere Löschreihenfolge.

## Server-Module (`apps/server/src`)

| Modul         | Verantwortung                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `auth`        | Accounts, Argon2id, Sessions, PostgreSQL-Rate-Limits, aktive Socket-Invalidierung und Ablauf-Cleanup |
| `character`   | Create/List/Select/GetSelected/Delete, Namensdomäne und Besitz                                       |
| `world`       | Eintritt, Online-Präsenz, Collider und persistente serverautoritative Bewegung                       |
| `simulation`  | Persistente Uhr, Energieprojektion und Interaktionszustände                                          |
| `core`        | Zod-Konfiguration, Proxy-Grenze, Origin-/CSRF-Schutz, CORS und Security-Header                       |
| `health`      | `GET /api/health`, prüft Server und Datenbank                                                        |
| `realtime`    | Validierter Socket.IO-Transport, Räume, Broadcasts und Simulationstakt                               |
| `persistence` | Globaler `PrismaService` als einziger DB-Zugang                                                      |
| `shared`      | HTTP-Exception-Filter und `ApplicationError` mit stabilen Fehlercodes                                |

Schichtenregeln:

- Controller und Gateways enthalten **keine Geschäftslogik** — sie validieren
  (Transport) und delegieren an Services (Anwendung).
- Datenbankzugriff erfolgt **ausschließlich** über `PrismaService` (direkt in
  Application Services oder über kleine konkrete Repositories wie in
  `character`), niemals aus Controllern, Gateways, Guards oder Interceptors.
- Neue fachliche Module werden als eigene Ordner neben den bestehenden angelegt
  — erst wenn ein konkretes Feature sie benötigt.

## Authentifizierung und Session (ADR 0007, 0012 und 0013)

- REST erzeugt, prüft und beendet serverseitige Sessions mit opakem
  256-Bit-Token und festem Ablauf. Passwörter verwenden Argon2id; unbekannte
  Login-E-Mails durchlaufen dieselbe teure Dummy-Prüfung.
- Registrierung besitzt ein IP-Limit von 3/min. Login kombiniert ein grobes
  IP-Limit von 20/min mit einem Limit von 5/min je IP und normalisierter
  E-Mail. Atomare Fixed-Window-Buckets liegen in PostgreSQL, enthalten nur
  gehashte Schlüssel und werden damit von allen Server-Replikaten geteilt.
- `TRUST_PROXY_HOPS` ist in Produktion Pflicht. Lokal ist der Wert 0; der
  Compose-Stack vertraut exakt einem internen Reverse-Proxy-Hop. Nur so ist
  `request.ip` eine belastbare Rate-Limit-Grenze.
- Abgelaufene Session-Zeilen werden beim Zugriff, beim Start und alle 15 Minuten
  entfernt. Ein lokales Register ordnet nach erfolgreichem Handshake alle Tabs
  einer Session zu. Logout und Ablauf senden einen stabilen Fehler und trennen
  sofort sämtliche zugehörigen Sockets.
- Normale WebSocket-Commands benötigen dadurch keinen Session-Lookup in
  PostgreSQL. Der feste Ablauftimer wird beim Registrieren geplant und hält den
  Node-Prozess nicht offen.
- `SessionAuthGuard`, `@CurrentPrincipal()`, exakte REST-/Socket-Origin-
  Allowlist, Secure/HttpOnly/SameSite-Cookie und zentrale Security-Header bilden
  die übrige Identitäts- und Browsergrenze.

## Netzwerkprotokoll (`libs/game-protocol`)

**Transportstrategie:** Auth und Character-Verwaltung laufen über REST.
Die Spielwelt nutzt den versionierten Socket.IO-Kanal `protocol`: Eintritt,
Bewegung und Interaktion sind Commands; Snapshot, Präsenz, Position, Energie
und Uhr sind Serverevents.
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
| DELETE  | `/api/characters/:id`        | `characterIdParamSchema`       | 204                           |
| POST    | `/api/characters/:id/select` | `characterIdParamSchema`       | 200 `CharacterDto`            |
| GET     | `/api/characters/selected`   | –                              | 200 `CharacterDto` / 404      |

Der erste erstellte Character eines Profils wird in derselben Transaktion
automatisch ausgewählt (ADR 0009); die Auswahl überlebt Server-Neustarts
(persistierte `selectedCharacterId`).

## Central Square und Simulationsloop (ADR 0010 und 0011)

- `central-square` verwendet ein gemeinsames logisches Koordinatensystem
  (0–100), Spawn (50, 70), Schrittweite 5 und code-native Collider für vier
  Gebäude und den Brunnen. Client und Server importieren dieselben Geometriedaten;
  allein der Server entscheidet, ob ein Ziel begehbar ist.
- Ungültig gewordene persistierte Positionen werden beim Eintritt zum Spawn
  repariert. Compare-and-Update über die Revision serialisiert konkurrierende
  Bewegungen; blockierte Bewegung schreibt nichts.
- Der Snapshot enthält nur aktuell präsente Characters. Der erste Socket eines
  Characters erzeugt `world-entity-joined`, der letzte
  `world-entity-left`; mehrere Tabs bleiben als eine Entity sichtbar.
- Die Simulationsuhr persistiert einen Anker aus simulierter Zeit, Realzeit und
  Geschwindigkeit. Nach Neustart wird die verstrichene Realzeit abgeleitet; ein
  geänderter `SIMULATION_SPEED` setzt einen neuen kontinuierlichen Anker.
- Energie fällt um 5 Punkte pro Simulationsstunde und bleibt in 0–100. Sie wird
  aus persistiertem Basiswert plus Zeit abgeleitet und bei relevanten Mutationen
  materialisiert.
- `world-interact` startet an der südlichen Bank eine exklusive,
  entfernungsgeprüfte Rast-Interaktion. Abschluss gibt 30 Energie; Bewegung,
  letzter Disconnect und Kontextverlust brechen sie ab. Tick-Events projizieren
  Uhr, Energie und Fortschritt auf alle Clients.
- Angular und Phaser mutieren Weltzustand nicht optimistisch. Sie rendern
  Snapshots sowie bestätigte Join-/Leave-/Move-/Update-/Clock-Events.

WebSocket-Nachrichten laufen über **einen** Socket.IO-Kanal (`protocol`) mit
einheitlicher, versionierter Hülle:

```typescript
{ version: 3, type: 'connect', requestId?: '<uuid>', timestamp: '<iso>', payload: { … } }
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
| Client→Server | `world-enter`            | Zone betreten                                  |
| Server→Client | `world-snapshot`         | Präsenz, eigene ID und Uhr initialisieren      |
| Client→Server | `world-move`             | Validierte Bewegungsrichtung anfordern         |
| Client→Server | `world-interact`         | Bank-Interaktion starten                       |
| Server→Client | `world-position-changed` | Persistierte Position broadcasten              |
| Server→Client | `world-entity-joined`    | Online-Entity hinzufügen                       |
| Server→Client | `world-entity-left`      | Offline-Entity entfernen                       |
| Server→Client | `world-entity-updated`   | Energie/Interaktion aktualisieren              |
| Server→Client | `simulation-clock`       | Simulationszeit synchronisieren                |
| Server→Client | `protocol-error`         | Technischen oder fachlichen Fehler übermitteln |

Fehlercodes (stabil, maschinenlesbar; REST und WS konsistent):

- Technisch: `UNSUPPORTED_PROTOCOL_VERSION`, `INVALID_MESSAGE`,
  `VALIDATION_ERROR`, `PERSISTENCE_ERROR`, `UNEXPECTED_ERROR`
- Auth/Sicherheit: `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`,
  `RATE_LIMITED`, `SESSION_EXPIRED`, `ORIGIN_NOT_ALLOWED`,
  `EMAIL_ALREADY_TAKEN`
- Character/World: `CHARACTER_NAME_INVALID`, `CHARACTER_NOT_FOUND`,
  `CHARACTER_NOT_OWNED`, `NO_CHARACTER_SELECTED`, `WORLD_NOT_ENTERED`,
  `WORLD_MOVE_BLOCKED`, `INTERACTION_OBJECT_NOT_FOUND`,
  `INTERACTION_OUT_OF_RANGE`, `INTERACTION_ALREADY_ACTIVE`

## Client (`apps/client`)

- `AuthService` hält Session-Zustand als Signals und liest niemals das
  HTTP-only Cookie.
- `CharacterService` verwaltet Liste und bestätigte Auswahl; nach Mutationen
  lädt er die Serverprojektion neu.
- `App` stellt beim Start die Session wieder her, verbindet Socket.IO nur
  authentifiziert und räumt bei Logout Character- und Verbindungszustand auf.
- `RealtimeService` ist der einzige Socket-Zugang. Er sendet ausschließlich
  validierte Commands und veröffentlicht ausschließlich validierte Events.
- `WorldStateService` projiziert Snapshot, Präsenz, Position, Uhr, Energie und
  Interaktion als Signals. Eine neue Connection-ID oder Character-Auswahl leert
  stale State und sendet erneut `world-enter`; Commands mutieren lokal nichts.
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

`renovate.json` ergänzt die CI um geplante Dependency-Pull-Requests:
nicht-breaking npm-/Actions-Updates werden gruppiert, Majors bleiben einzeln
und ein wöchentlicher Lockfile-Wartungslauf ist vorgesehen. Die Repository-
Aktivierung der Renovate GitHub App bleibt ein manueller Administrationsschritt.

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
