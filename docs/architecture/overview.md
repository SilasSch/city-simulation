# Architekturüberblick

## Leitidee

Der Server ist die alleinige Wahrheit über den Weltzustand
(**server-authoritative**, ADR 0003). Clients senden Commands und Queries,
niemals eigene Zustandsänderungen. Alle Daten an Netzwerkgrenzen werden zur
Laufzeit mit Zod validiert (ADR 0004).

Das Backend ist ein **modularer Monolith** (ADR 0002): eine Anwendung, klare
Module, keine Microservices.

## Bausteine

```text
┌────────────┐   REST /api/*    ┌─────────────────────────────┐
│            │ ◄──────────────► │                             │
│   client   │                  │   server (NestJS-Monolith)  │
│  Angular   │   Socket.IO      │                             │
│  + Phaser  │ ◄──────────────► │   core · health · realtime  │
│            │  Kanal: protocol │   persistence · shared      │
└────────────┘                  └──────────────┬──────────────┘
                                               │ PrismaService
                                        ┌──────▼──────┐
                                        │ PostgreSQL  │
                                        └─────────────┘

libs/shared-types   → reine TS-Typen (HealthResponseDto), keine Deps
libs/game-protocol  → Zod-Schemas, Protokollhülle, Parser, Fehlercodes
```

## Server-Module (`apps/server/src`)

| Modul         | Verantwortung                                                      |
| ------------- | ------------------------------------------------------------------ |
| `core`        | Zod-validierte Konfiguration (fail fast beim Start)                |
| `health`      | REST-Health-Endpunkt (`GET /api/health`), prüft Server + Datenbank |
| `realtime`    | Socket.IO-Gateway (Transport) + Message-Service (Behandlung)       |
| `persistence` | `PrismaService` als einziger DB-Zugang, global bereitgestellt      |
| `shared`      | Globaler HTTP-Exception-Filter (sichere Fehlerstruktur nach außen) |

Schichtenregeln:

- Controller und Gateways enthalten **keine Geschäftslogik** — sie validieren
  (Transport) und delegieren an Services (Anwendung).
- Datenbankzugriff erfolgt **ausschließlich** über `PrismaService`, niemals aus
  Controllern, Gateways, Guards oder Interceptors.
- Neue fachliche Module werden als eigene Ordner neben den bestehenden angelegt
  — erst wenn ein konkretes Feature sie benötigt.

## Netzwerkprotokoll (`libs/game-protocol`)

Alle WebSocket-Nachrichten laufen über **einen** Socket.IO-Kanal (`protocol`)
und verwenden eine einheitliche, versionierte Hülle:

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
  maschinenlesbarem Code (`UNSUPPORTED_PROTOCOL_VERSION`, `INVALID_MESSAGE`,
  `VALIDATION_ERROR`, `PERSISTENCE_ERROR`, `UNEXPECTED_ERROR`) und der
  ursprünglichen `requestId`, falls vorhanden.
- Bei nicht unterstützter Version bleibt die Verbindung offen (ADR 0006).

Aktuelle technische Nachrichten (bewusst kein Gameplay):

| Richtung      | type                     | Bedeutung                  |
| ------------- | ------------------------ | -------------------------- |
| Client→Server | `connect`                | ConnectCommand             |
| Server→Client | `connection-established` | ConnectionEstablishedEvent |
| Server→Client | `protocol-error`         | ProtocolErrorEvent         |

REST: `GET /api/health` → `HealthResponseDto` (200 bei `ok`, 503 wenn die
Datenbank nicht erreichbar ist; keine Verbindungsdetails im Body).

## Client (`apps/client`)

- `StatusViewComponent` — zeigt REST-Health, WebSocket-Status und die letzte
  Protokollmeldung über **Angular Signals** an.
- `ApiService` — REST-Zugang, validiert Antworten mit Zod (`healthResponseSchema`).
- `RealtimeService` — einziger WebSocket-Zugang; sendet validierte Commands,
  validiert eingehende Events, bildet Fehlerzustände als Signals ab.
- `GameHostComponent` + `GameEngineService` — Phaser-Grenze: Engine startet
  außerhalb der Angular-Zone, Boot-Scene liefert nur den technischen
  Startnachweis, `ngOnDestroy` zerstört die Engine kontrolliert.

Angular ist für Shell und UI zuständig, Phaser später für die Spielwelt.
Geschäftslogik hat in Komponenten nichts zu suchen.

## Modulgrenzen

ESLint (`@nx/enforce-module-boundaries`) erzwingt:

- `scope:client` und `scope:server` dürfen nur `scope:shared` importieren.
- `scope:shared` darf nur `scope:shared` importieren.

Damit ist sichergestellt, dass Client und Server ausschließlich über die
gemeinsamen Libraries gekoppelt sind.

## Fehlerbehandlung und Logging

- Vier Fehlerkategorien: Validation, Protocol, Persistence, Unexpected.
- REST-Fehler laufen durch den globalen Exception-Filter: nach außen stabil
  (`statusCode`, `code`, `message`, `timestamp`, `path`), nach innen voller
  Stack im Log. Keine Stacktraces, Pfade oder DB-Details nach außen.
- WebSocket-Abweisungen werden strukturiert geloggt (Event, Code, requestId,
  socketId) und als `ProtocolErrorEvent` beantwortet.
- Logs enthalten Timestamp, Level, Kontext und fachliche Metadaten — keine
  sensiblen Inhalte (Payloads mit Verbindungsdaten o. ä.).

## Tests

| Test                                                     | Projekt       |
| -------------------------------------------------------- | ------------- |
| Zod-Schemas + `parseIncomingMessage` (frameworkfrei)     | game-protocol |
| Health-Endpunkt 200/503 (Integration, Prisma gemockt)    | server        |
| WebSocket: `connection-established`                      | server        |
| WebSocket: nicht unterstützte Version → `protocol-error` | server        |
| WebSocket: malformed → `INVALID_MESSAGE`                 | server        |
| Angular: `StatusViewComponent` rendert Status            | client        |
| Phaser: Engine bootet (HEADLESS) und wird zerstört       | client        |
