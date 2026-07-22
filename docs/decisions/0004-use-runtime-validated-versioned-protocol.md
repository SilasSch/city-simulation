# 0004: Laufzeitvalidiertes, versioniertes Netzwerkprotokoll

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

TypeScript-Typen existieren nur zur Compile-Zeit. An der Netzwerkgrenze
(WebSocket, REST) treffen beliebige, auch fehlerhafte oder böswillige Daten
ein. Zusätzlich werden sich Client- und Server-Versionen im Betrieb
temporär unterscheiden (Deployments, veraltete Browser-Tabs).

## Entscheidung

Alle WebSocket-Nachrichten verwenden eine versionierte Hülle
(`version`, `type`, `requestId?`, `timestamp`, `payload`). Alle Schemas liegen
zentral in `libs/game-protocol` (Zod), Typen werden mit `z.infer` abgeleitet.
Jede Nachricht an beiden Richtungen wird zur Laufzeit validiert — Server wie
Client. `PROTOCOL_VERSION` ist genau einmal definiert.

## Gründe

- Zod-Schemas sind Vertrag und Validator in einem — keine doppelt gepflegten
  Typen und Validierer.
- Die Hülle macht Version, Typ und Korrelation (`requestId`) für alle
  Nachrichten einheitlich verfügbar.
- REST-Antworten werden im Client ebenfalls validiert (`healthResponseSchema`);
  ein Compile-Zeit-Abgleich verhindert Drift zum `HealthResponseDto`.

## Betrachtete Alternativen

- **Nur TypeScript-Interfaces:** keine Laufzeitgarantie — verworfen.
- **class-validator/class-transformer (serverseitig):** doppelte
  Vertragsdefinition, nicht mit dem Client teilbar.
- **Protobuf/FlatBuffers:** starke Typisierung und Effizienz, aber Build-
  Tooling und schlechtere Lesbarkeit — für den aktuellen Umfang überdimensioniert.

## Konsequenzen

- Jede neue Nachricht beginnt als Zod-Schema in `game-protocol` inklusive Test.
- Validierungsfehler sind keine Programmfehler, sondern erwartbare
  Protokollereignisse (`ProtocolErrorEvent`) und werden entsprechend geloggt.
