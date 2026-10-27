# 0015: In-Memory-Zonen-Tick mit Client-Prediction

- **Status:** Akzeptiert (Umsetzung ab v0.10, #83–#85)
- **Datum:** 2026-10-27
- **Ersetzt nach Umsetzung:** schrittweises `world-move` mit Persistenz pro
  Schritt und das Verbot optimistischer Positionsdarstellung aus ADR 0010
- **Spec:** [`docs/plans/3d-v1.0.md`](../plans/3d-v1.0.md)

## Kontext

Bisher ist jede Bewegung ein Schritt von 5 Einheiten in N/E/S/W. Jeder Schritt
ist eine eigene PostgreSQL-Transaktion mit revisionsbasiertem
Compare-and-Update, und der Client zeigt erst die bestätigte Position.
Gedrückt gehaltene Tasten erzeugen keine Wiederholung. Für einen 3D-Client mit
flüssiger, stufenloser Bewegung ist das zu grob und zu langsam. Die DB-Last
würde mit der Bewegungsfrequenz statt mit fachlichen Ereignissen wachsen.

## Entscheidung

- Der **Server bleibt die Autorität** (ADR 0003). Pro Zone läuft ein Tick mit
  **20 Hz**, der Positionen im Speicher hält, Bewegungs-Inputs anwendet und
  die Zonenstände broadcastet.
- Bewegung ist **kinematisch**, ohne Physik-Simulation: konstante
  Laufgeschwindigkeit (Startwert 6 Einheiten/s, justierbar) und Gleiten
  entlang der gemeinsamen Rechteck- und Kreis-Collider. Zwischen Entities gibt
  es keine Kollision.
- Der Client sendet nur **Bewegungsabsichten**: einen Richtungsvektor
  (Länge ≤ 1) mit Sequenznummer. Der Server validiert und rate-limitiert sie.
- Der Client **sagt die eigene Figur voraus** und gleicht sie sanft an die
  Server-Position an, mit der zuletzt verarbeiteten Sequenz im Tick-Broadcast.
  Fremde Spieler und NPCs werden zwischen Server-Ständen interpoliert.
- **Persistenz:** Positionen alle 5 s sowie sofort bei Zonenwechsel,
  Interaktionsstart, Disconnect und Graceful Shutdown. Geld, Energie und
  Interaktionen bleiben sofort transaktional gespeichert.
- Reichweitenprüfungen für Interaktionen, Portale und NPCs verwenden die
  Tick-Position.
- **Harter Protokollbruch:** `PROTOCOL_VERSION` 3 → 4. `world-move` mit
  N/E/S/W entfällt ohne Rückwärtskompatibilität. Alte Clients erhalten die
  Antwort aus ADR 0006.
- NPC-Patrouillen bewegen sich im selben Tick mit Laufgeschwindigkeit.

## Betrachtete Alternativen

- **DB-Transaktion pro Bewegung beibehalten:** zu hohe Last und spürbare
  Latenz bei flüssiger Bewegung.
- **Clientautoritative Positionen:** einfach, aber manipulierbar.
- **Physik-Engine auf dem Server:** kein fachlicher Nutzen für eine
  Lebenssimulation, viel Komplexität.
- **Ohne Client-Prediction:** Eingaben würden um mindestens eine
  Round-Trip-Zeit verzögert wirken.

## Konsequenzen

- Bei einem Serverabsturz gehen bis zu ~5 s Laufweg verloren. Das ist
  bewusst akzeptiert.
- Positionen sind prozesslokal wie die Presence (ADR 0010). Horizontale
  Skalierung bräuchte Zonen-Sharding oder einen gemeinsamen Zustandslayer.
- Client und Server müssen dieselbe Bewegungs- und Kollisionsfunktion
  verwenden. Sie liegt daher in `libs/game-protocol`.
- Tests für die ersetzte Schritt-Bewegung werden neu geschrieben.
