# 0009: Automatische Auswahl des ersten Characters

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

Nach dem Anlegen des allerersten Characters hätte ein Spieler sonst regelmäßig
einen Zwischenschritt („kein Character ausgewählt"), obwohl es fachlich nur
eine sinnvolle Auswahl gibt. Gleichzeitig darf implizites Verhalten spätere,
bewusste Auswahlentscheidungen nicht überschreiben.

## Entscheidung

**Der erste erstellte Character eines Player Profiles wird automatisch
ausgewählt.** Konkret: `CreateCharacter` prüft in einer Datenbanktransaktion
die Anzahl vorhandener Characters des Profils; ist sie 0, wird der neue
Character in derselben Transaktion als `selectedCharacterId` gesetzt.
Weitere Characters ändern die Auswahl nicht — dafür existiert
`SelectCharacter` explizit.

## Gründe

- Der Erststart („Registrieren → Character anlegen → spielbereit") hat
  keinen redundanten Klick und keinen fachlich sinnlosen Leerzustand.
- Die Transaktion macht Anlage + Auswahl atomar: kein beobachtbarer
  Zwischenzustand, kein verwaister Character bei Fehlern.
- Die Bedingung „erster Character" ist serverseitig eindeutig prüfbar;
  der Client rät nichts (server-authoritative).

## Betrachtete Alternativen

- **Keine Auto-Auswahl:** ehrlich, aber schlechter Erstlauf; der Client
  müsste die Auswahl ohnehin sofort nachholen.
- **Jeder neu erstellte Character wird ausgewählt:** überschreibt laufende
  bewusste Auswahl — überraschend, verworfen.
- **Auto-Auswahl im Client auslösen:** racy und doppelt implementiert;
  verletzt server-authoritative Verantwortung.

## Konsequenzen

- `GetSelectedCharacter` liefert nach der ersten Charaktererstellung sofort
  ein Ergebnis; `NO_CHARACTER_SELECTED` bleibt der kontrollierte Fehler für
  Profile ohne Character (oder nach künftigen Löschungen).
- Tests sichern das Verhalten: Auto-Auswahl nur beim ersten Character,
  Persistenz der Auswahl über Server-Neustarts hinweg.
