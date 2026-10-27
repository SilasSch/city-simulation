# 0014: Three.js-3D-Renderer statt Phaser

- **Status:** Akzeptiert (Umsetzung ab v0.10, #82)
- **Datum:** 2026-10-27
- **Spec:** [`docs/plans/3d-v1.0.md`](../plans/3d-v1.0.md)

## Kontext

Der Phaser-Client hat den Umfang bis v0.9 als 2D-Prototyp bewiesen. Für v1.0
soll derselbe Umfang in 3D laufen, mit drehbarer Kamera, animierten Figuren,
Licht und Tag/Nacht. Phaser ist eine 2D-Engine und deckt das nicht ab. Eine
Physik-Engine wird nicht gebraucht: Kollision und Bewegung entscheidet
weiterhin der Server (ADR 0003, 0015).

## Entscheidung

- **Three.js** ersetzt Phaser vollständig. Es gibt keinen parallelen
  2D-Client und keinen Umschalter.
- Angular bleibt Shell, HUD und Menü. Three.js rendert nur die Weltprojektion
  und läuft wie bisher außerhalb der Angular-Zone.
- Die Spiellogik bleibt **flach**: Die logischen `(x, y)` aus
  `libs/game-protocol` mit Rechteck- und Kreis-Collidern sind die einzige
  Geometriequelle. Gerendert wird `(x, 0, y)` mit 1 Einheit = 0,5 m. Es gibt
  keine Höhe und keine Innenräume.
- **Plattform:** aktuelle Desktop-Browser mit WebGL2, ohne Fallbacks und ohne
  Mobile-Support. Das Budget von 60 fps auf Onboard-GPU begrenzt Licht,
  Schatten und Effekte.
- Kamera: Schrägansicht wie bei Sims, drehbar und zoombar mit Grenzen.
  Verdeckende Gebäude werden halbtransparent.
- Assets sind CC0-Low-Poly-Pakete (Kenney, Quaternius), liegen im Repo unter
  `apps/client/public/assets/` mit `CREDITS.md` und einem Budget von höchstens
  ~20 MB, ohne Git LFS. Figuren sind modular mit gemeinsamem Skelett, damit
  später Kleidung möglich ist.

## Betrachtete Alternativen

- **Babylon.js:** bringt Physik, Inspector und Szenen-Tooling mit. Ohne
  Physik-Bedarf ist das vor allem zusätzliches Gewicht und eine zweite
  Architektur neben Angular.
- **Phaser beibehalten (2,5D/isometrisch):** keine echte Kamera-Rotation,
  kein Licht- und Schattenmodell.
- **2D- und 3D-Client parallel:** verdoppelt jede Karten- und
  Darstellungsänderung.
- **Eigene Modelle:** zu hoher Aufwand für den Projektumfang.

## Konsequenzen

- Die Dependency `phaser`, Phaser-Texturen und der Phaser-Map-Code entfallen.
  Tests für den ersetzten Engine-Code werden neu geschrieben.
- Die Karten bleiben code-nativ. Die 3D-Platzierung muss deckungsgleich mit
  den gemeinsamen Collidern sein.
- Lizenz und Herkunft jedes Asset-Pakets müssen in `CREDITS.md` gepflegt
  werden.
- Ältere Browser und Mobilgeräte werden bewusst nicht unterstützt.
