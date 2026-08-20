# Agent instructions

## Ticket-first

- Keine Implementierung ohne vorhandenes GitHub-Issue.
- Vor Arbeitsbeginn Issue lesen und Scope bestätigen.
- Für neue oder zusätzlich entdeckte Arbeit zuerst ein eigenes Issue erstellen; nicht still in einen laufenden PR aufnehmen.
- Ein PR bearbeitet genau ein kohärentes Ticket beziehungsweise einen ausdrücklich zusammengehörenden Ticket-Scope.
- Keine fremden Refactorings, Dependency-Updates oder Aufräumarbeiten im selben PR.

## Branches und Pull Requests

- Änderungen immer auf einem eigenen Branch, niemals direkt auf `main`.
- PR zunächst als Draft öffnen.
- PR-Beschreibung verlinkt das Issue und verwendet bei vollständiger Umsetzung `Closes #<issue>`.
- PR beschreibt knapp Scope, manuelle Verifikation und bewusst nicht ausgeführte Checks.
- Kein Merge, Deployment oder Schließen zusätzlicher Issues ohne ausdrücklichen Auftrag.

## Test- und Validierungspolitik

- Keine neuen automatisierten Tests, Testdateien, Test-Suites oder zusätzlichen CI-Testpflichten einführen, außer der Nutzer verlangt dies ausdrücklich.
- Bestehende Tests nicht löschen oder umgehen.
- Nur den kleinsten bereits vorhandenen Check ausführen, der die Änderung sinnvoll abdeckt.
- Für UI- und Gameplay-Arbeit kurze manuelle Verifikation bevorzugen.
- Keine vollständigen Test-, E2E-, Docker- oder Playwright-Läufe, sofern das Issue sie nicht ausdrücklich verlangt.
- Nach dem Push die bestehende GitHub-CI verwenden und keine bereits abgedeckten Komplettprüfungen lokal wiederholen.

## Scope und Kommunikation

- Bei Blockern stoppen und den konkreten Blocker melden, statt den Scope eigenmächtig zu erweitern.
- Keine produktiven Server-, Datenbank- oder Deployment-Änderungen aus einem normalen Feature-/Bug-Ticket heraus.
- Arbeitsbaum vor Commit und Push auf fremde Änderungen prüfen.
- Im Abschlussbericht Issue, Branch, Commit, PR, ausgeführte manuelle Prüfung und CI-Status nennen.
