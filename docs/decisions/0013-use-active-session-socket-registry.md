# 0013: Aktive Session-Socket-Invalidierung

- **Status:** Akzeptiert
- **Datum:** 2026-08-19
- **Ersetzt:** die Revalidierung vor jedem WebSocket-Command aus ADR 0007 und 0010

## Kontext

Ein Datenbank-Lookup vor jedem WebSocket-Command skaliert mit der
Command-Frequenz statt mit Auth-Ereignissen. Logout und fester Ablauf müssen
bereits verbundene Tabs trotzdem unmittelbar sperren.

## Entscheidung

- Der Socket.IO-Handshake löst die Session einmal in PostgreSQL auf.
- Ein lokales Register ordnet der Session alle verbundenen Socket-IDs zu und
  plant genau einen Timer für ihren festen Ablauf.
- Logout, Lazy-Expiry und periodischer Session-Cleanup widerrufen die Session
  im Register. Alle zugehörigen Sockets erhalten einen stabilen Fehler und
  werden sofort getrennt.
- Der normale Command-Pfad vertraut danach dem authentifizierten Socket-Kontext
  und fragt die Session nicht erneut aus der Datenbank ab.
- Der letzte World-Socket eines Characters beendet dessen aktive Interaktion.

## Betrachtete Alternativen

- **DB-Lookup pro Command:** einfach, aber unnötig teuer und latenzabhängig.
- **Nur Disconnect beim aktuellen Tab:** lässt weitere Tabs aktiv.
- **Periodisches Socket-Polling:** verzögert Widerruf und erzeugt weiter
  Datenbanklast.

## Konsequenzen

- Command-Last erzeugt keine Auth-Datenbankabfragen mehr.
- Mehrere Tabs derselben Session werden gemeinsam widerrufen; einzelne
  Tab-Disconnects lassen die übrigen Sockets bestehen.
- Das Register ist pro Serverprozess. Bei mehreren WebSocket-Replikaten muss
  ein Logout zusätzlich über einen gemeinsamen Pub/Sub-Kanal an alle Prozesse
  verteilt werden; die Session bleibt unabhängig davon in PostgreSQL ungültig.
