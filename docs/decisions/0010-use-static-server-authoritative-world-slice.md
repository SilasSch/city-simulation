# 0010: Minimaler serverautoritärer World-Slice in statischer Zone

- **Status:** Akzeptiert und um gemeinsame Geometrie sowie Live-Präsenz erweitert
- **Datum:** 2026-08-12

## Kontext

Nach Authentifizierung und Character-Auswahl braucht das Projekt den kleinsten
Spielwelt-Slice, der die serverautoritative Architektur durchgängig beweist.
Er soll Persistenz, Reconnect, gemeinsame Protokollverträge und Broadcasts
abdecken, ohne bereits Wirtschaft, NPCs oder dynamische Zonen einzuführen.

## Entscheidung

- Es gibt genau eine statische Zone `central-square` mit ganzzahligen
  Koordinaten von 0 bis 100, Spawnpunkt (50, 70) und einer Schrittweite von 5.
- Client und Server importieren dieselben code-nativen Collider für vier
  Gebäude und den zentralen Brunnen. Nur der Server entscheidet, ob eine
  Zielposition begehbar ist.
- `world-enter` erfordert einen serverseitig ausgewählten Character. Eine
  persistierte Position, die nach einer Kartenänderung nicht mehr begehbar ist,
  wird atomar zum Spawnpunkt verschoben.
- `CharacterWorldState` persistiert Zone, Position und Revision in einer
  Eins-zu-eins-Beziehung zum Character.
- `world-move` akzeptiert ausschließlich `N`, `E`, `S` oder `W`. Der
  Server prüft Grenze und Collider, persistiert gültige Ziele mit einem
  revisionsbasierten Compare-and-Update und broadcastet erst danach
  `world-position-changed`. Blockierte Bewegung schreibt keinen Zustand.
- Der Snapshot enthält nur aktuell präsente Characters. Der erste Socket eines
  Characters erzeugt `world-entity-joined`, der letzte
  `world-entity-left`; mehrere Tabs bleiben eine sichtbare Entity.
- Reconnect und Character-Wechsel verwerfen den bisherigen Eintrittskontext
  und erfordern einen neuen `world-enter`.
- Angular und Phaser ändern Positionen nicht optimistisch. Sie zeigen
  ausschließlich durch Snapshot oder Serverevent bestätigten Zustand.
- Vor jedem World-Command wird die Session erneut validiert, damit Logout und
  Ablauf auch bereits verbundene Sockets sperren.

## Betrachtete Alternativen

- **Clientautoritative Positionen:** zu leicht manipulierbar und widersprechen
  der gewählten Architektur.
- **Getrennte Client-/Server-Geometrie:** würde Collider und Darstellung
  unvermeidlich auseinanderlaufen lassen.
- **Persistierte Presence:** bildet kurzlebige Socket-Zustände unnötig in der
  Datenbank ab und würde abgestürzte Verbindungen als online erscheinen lassen.
- **REST-Polling:** bildet bidirektionale Bewegung und Broadcasts unnötig
  indirekt ab.
- **Dynamische Karten und Zonenpersistenz:** erhöhen den Umfang, ohne den
  Vertical Slice besser zu beweisen.

## Konsequenzen

- Ein eigenes World-Modul kapselt Persistenz, Live-Präsenz und serverseitige
  Regeln; Client und Server teilen die versionierten Zod-Verträge.
- Gleichzeitige Bewegungen werden über Revisionen serialisiert, und die
  gemeinsame Geometrie verhindert sichtbare Server-/Client-Drift.
- Presence ist für den aktuellen Single-Server-Meilenstein prozesslokal. Bei
  horizontaler Skalierung benötigt sie einen gemeinsamen Pub/Sub-Layer.
- Der Slice beweist Eintritt, Kollision, Bewegung, Persistenz, Broadcast,
  Mehrfach-Tab-Presence und Reconnect, enthält aber bewusst nur eine Zone.
