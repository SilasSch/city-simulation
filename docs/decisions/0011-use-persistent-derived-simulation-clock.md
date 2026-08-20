# 0011: Persistente, abgeleitete Simulationsuhr

- **Status:** Akzeptiert
- **Datum:** 2026-08-19

## Kontext

Energie und zeitgebundene Interaktionen benötigen eine gemeinsame
serverautoritative Zeit. Ein reiner Prozess-Timer würde bei Neustarts springen
oder Zeit verlieren; ein Datenbankschreibvorgang pro Tick wäre unnötig teuer.

## Entscheidung

- `SimulationClock` speichert genau einen Anker aus simulierter Zeit,
  zugehöriger Realzeit und Geschwindigkeit.
- Die aktuelle Simulationszeit wird als
  `simulatedAt + max(0, realNow - realAt) * speed` abgeleitet.
- Ein Serverneustart liest den Anker und führt die Zeit inklusive der real
  verstrichenen Downtime kontinuierlich fort.
- Ändert sich `SIMULATION_SPEED`, materialisiert der Start zuerst die bisher
  abgeleitete Zeit und schreibt darauf einen neuen Anker. Dadurch gibt es
  keinen Zeitsprung.
- Rückwärts laufende Systemzeit wird auf null verstrichene Zeit begrenzt.
- Energie und Interaktionsfristen verwenden ausschließlich Simulationszeit.
  Der Sekundentakt broadcastet Projektionen, ist aber nicht selbst die Uhr.

## Betrachtete Alternativen

- **Nur In-Memory-Timer:** verliert Kontinuität bei Neustart.
- **Simulationszeit jedes Tick persistieren:** erzeugt dauernde Schreiblast
  ohne zusätzlichen fachlichen Zustand.
- **Nur echte UTC-Zeit:** erlaubt keine steuerbare Simulationsgeschwindigkeit.

## Konsequenzen

- Neustarts und Geschwindigkeitsänderungen bleiben kontinuierlich.
- Uhr, Energie und Interaktionen können aus wenigen persistenten Ankern
  deterministisch rekonstruiert werden.
- Änderungen an der Systemzeit werden nicht rückwärts übernommen; für mehrere
  Serverinstanzen muss deren reale Uhr ausreichend synchronisiert sein.
