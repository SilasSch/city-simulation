# 0006: Umgang mit nicht unterstützten Protokollversionen

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

Nach einem Server-Deployment mit neuer Protokollversion können Clients mit
alter Version verbunden bleiben (veraltete Tabs, langsame Rollouts). Ein
stilles Ignorieren oder generische Fehler machen solche Zustände
undebuggbar.

## Entscheidung

Bei einer nicht unterstützten Protokollversion:

1. Die Nachricht wird normal validiert (Hülle), dann die Version geprüft.
2. Der Server sendet ein `ProtocolErrorEvent` mit dem stabilen Code
   `UNSUPPORTED_PROTOCOL_VERSION`, der unterstützten und der empfangenen
   Version sowie der `requestId` der Ursprungsnachricht (falls vorhanden).
3. Der Command wird **nicht** ausgeführt.
4. Der Vorgang wird strukturiert geloggt (Code, requestId, socketId).
5. **Die Verbindung bleibt offen** für weitere, möglicherweise gültige
   Nachrichten.

## Gründe für "Verbindung bleibt offen"

- Ein Versionskonflikt betrifft einzelne Nachrichten, nicht zwingend die
  gesamte Verbindung: ein Client kann im gleichen Protokoll unterschiedliche
  Nachrichtentypen senden, und ein Reload kann den Konflikt jederzeit lösen.
- Der Client kann dem Nutzer den Fehlerzustand gezielt anzeigen (Signal
  `protocolError`), statt eine abgebrochene Verbindung zu raten.
- Schließen bleibt für schwerere Fälle reserviert (z. B. Missbrauch,
  wiederholte ungültige Nachrichten) und wird dann explizit entschieden.

## Betrachtete Alternativen

- **Verbindung sofort schließen:** einfacher, aber hart für Mischzustände und
  verschlechtert die Diagnose (Client sieht nur Disconnect).
- **Stille Toleranz / Best-Effort-Ausführung:** führt zu unterschiedlichen
  Interpretationen desselben Zustands — inakzeptabel für eine
  server-authoritative Architektur.
- **Automatische Protokoll-Aushandlung (Negotiation):** sinnvoll ab der ersten
  echten zweiten Version; jetzt bewusst nicht vorweggenommen.

## Konsequenzen

- Eine Erhöhung von `PROTOCOL_VERSION` braucht einen Migrationsplan:
  Server akzeptiert übergangsweise ggf. mehrere Versionen, Clients werden
  aktualisiert, alte Version wird entfernt.
- Tests decken den Mismatch ab (Server: `realtime.gateway.spec.ts`; Parser:
  `libs/game-protocol/src/protocol.spec.ts`).
