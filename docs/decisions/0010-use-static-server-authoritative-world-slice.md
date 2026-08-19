# 0010: Minimaler serverautoritärer World-Slice in statischer Zone

- **Status:** Teilweise fortgeschrieben durch ADR 0011 und 0013
- **Datum:** 2026-08-12

## Kontext

Nach Authentifizierung und Character-Auswahl braucht das Projekt den kleinsten
Spielwelt-Slice, der die serverautoritative Architektur durchgängig beweist.
Er soll Persistenz, Reconnect, gemeinsame Protokollverträge und Broadcasts
abdecken, ohne bereits Karten, Kollisionen, Wirtschaft oder NPCs einzuführen.

## Entscheidung

- Es gibt genau eine statische Zone `central-square` mit ganzzahligen
  Koordinaten von 0 bis 100, Spawnpunkt (50, 50) und einer Schrittweite von 5.
- `world-enter` erfordert einen serverseitig ausgewählten Character und liefert
  einen vollständigen `world-snapshot` der Zone.
- `CharacterWorldState` persistiert Zone, Position und Revision in einer
  Eins-zu-eins-Beziehung zum Character.
- `world-move` akzeptiert ausschließlich `N`, `E`, `S` oder `W`. Der Server
  berechnet und begrenzt die Zielposition, persistiert sie mit einem
  revisionsbasierten Compare-and-Update und broadcastet erst danach
  `world-position-changed`.
- Reconnect und Character-Wechsel verwerfen den bisherigen Eintrittskontext
  und erfordern einen neuen `world-enter`.
- Angular und Phaser ändern Positionen nicht optimistisch. Sie zeigen
  ausschließlich durch Snapshot oder Serverevent bestätigten Zustand.
- Vor jedem World-Command wird die Session erneut validiert, damit Logout und
  Ablauf auch bereits verbundene Sockets sperren.

## Betrachtete Alternativen

- **Clientautoritative Positionen:** zu leicht manipulierbar und widersprechen
  der gewählten Architektur.
- **Nur In-Memory-Zustand:** würde Reconnect und Serverneustart nicht überleben.
- **REST-Polling:** bildet bidirektionale Bewegung und Broadcasts unnötig
  indirekt ab.
- **Dynamische Karten und Zonenpersistenz:** erhöhen den Umfang, ohne den
  Vertical Slice besser zu beweisen.
- **Prediction und Interpolation:** sind erst bei realen Latenz- und
  Bewegungsanforderungen sinnvoll.

## Konsequenzen

- Ein eigenes World-Modul kapselt Persistenz und serverseitige Regeln;
  Client und Server teilen die versionierten Zod-Verträge.
- Gleichzeitige Bewegungen werden über Revisionen serialisiert und
  Koordinaten bleiben innerhalb der festen Zonengrenzen.
- Der Slice beweist Eintritt, Bewegung, Persistenz, Broadcast und Reconnect,
  enthält aber bewusst nur eine Zone und keine Kollisionen, Karten, Wirtschaft,
  NPCs oder autonome Agenten.
