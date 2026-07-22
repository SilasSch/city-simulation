# 0003: Server-authoritative Architektur

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

In einer persistenten Multiplayer-Stadt dürfen Clients den Weltzustand nicht
selbst bestimmen (Konsistenz, Betrugsschutz, spätere autonome Agenten).
Gleichzeitig soll der Client reaktionsschnell bleiben.

## Entscheidung

Der Server ist die alleinige Wahrheit über den Weltzustand. Clients senden
ausschließlich **Commands** (gewünschte Aktionen), **Queries** (Anfragen) und
technische Verbindungsinformationen. Der Server entscheidet, validiert und
teilt Ergebnisse als **Events** mit. Auch die technische Demoverbindung folgt
diesem Muster (`connect` → `connection-established`).

## Gründe

- Eine Autorität verhindert divergierende Zustände zwischen Spielern.
- Events als "bereits erfolgt"-Tatsachen machen die Kommunikationsrichtung
  eindeutig und testbar.
- Autonome Akteure (regelbasiert oder LLM-gestützt) können später serverseitig
  dieselben Commands nutzen wie menschliche Clients.

## Betrachtete Alternativen

- **Client-seitige Zustandsführung mit Synchronisation:** einfacher Start,
  aber inkonsistent und später kaum rückbaubar.
- **Peer-to-Peer:** ausgeschlossen für eine persistente Welt.

## Konsequenzen

- Client-seitige Optimism-Strategien (falls später gewünscht) müssen
  Server-Entscheidungen immer als final akzeptieren.
- Jede Zustandsänderung braucht einen validierten Command-Pfad über
  `game-protocol` — keine Hintertür per REST-Mutation ohne Vertrag.
