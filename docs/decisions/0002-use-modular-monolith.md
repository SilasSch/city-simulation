# 0002: Modularer Monolith fürs Backend

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

Langfristig entstehen viele fachliche Bereiche (Charaktere, Welt, Simulation,
Wirtschaft, …). Die Versuchung ist groß, früh auf Microservices oder komplexe
Frameworks (CQRS, Event Sourcing) zu setzen — oder umgekehrt alles
ungeordnet in eine App zu kippen.

## Entscheidung

Das Backend bleibt **eine** NestJS-Anwendung mit klar getrennten Modulen
(`core`, `health`, `realtime`, `persistence`, `shared` — fachliche Module
erst bei konkretem Bedarf). Module kommunizieren nur über ihre öffentlichen
Provider; Transport-Schichten enthalten keine Geschäftslogik; Datenbankzugriff
nur über `PrismaService`.

## Gründe

- Eine Prozess- und Deployment-Einheit ist lokal und in der CI trivial zu
  starten und zu testen.
- Fachliche Grenzen werden durch Modulstruktur + Review + Linting durchgesetzt,
  nicht durch Netzwerkgrenzen.
- Refactoring zwischen Modulen bleibt billig (keine API-Verträge nötig).

## Betrachtete Alternativen

- **Microservices:** verteilte Komplexität (Netz, Konsistenz, Betrieb) ohne
  aktuellen Nutzen.
- **CQRS-/Event-Sourcing-Frameworks:** Konzepte (Commands/Events/Queries)
  werden als Benennungs- und Strukturprinzip übernommen, aber ohne Framework-
  Zeremonie.
- **"Erst mal alles in AppModule":** macht spätere Trennung teuer — verworfen.

## Konsequenzen

- Neue Features erzeugen ein neues Modul mit klarer Verantwortung, statt
  bestehende Transport-Dateien aufzublähen.
- Skaliert die Last später wirklich, kann ein Modul mit klaren Schnittstellen
  herausgelöst werden — erst dann.
