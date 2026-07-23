# 0008: Trennung von User Account, Player Profile und Character

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

„Der eingeloggte Mensch" und „die Figur im Spiel" werden in solchen Projekten
gern zu einem „User" verschmolzen. Das vermischt technische Login-Identität
mit Spielbesitz und erschwert später alles von mehreren Charakteren über
Account-Löschung bis OIDC-Migration.

## Entscheidung

Drei klar getrennte Konzepte (Prisma-Modelle):

- **User Account** — technische Login-Identität: E-Mail, Passwort-Hash,
  Besitzer der Sessions. Keine Spielbegriffe.
- **PlayerProfile** — fachliche Identität des Menschen im Spiel: genau eins
  pro Account (`userId` unique), besitzt Characters, hält den aktuell
  ausgewählten Character.
- **Character** — steuerbare Figur: `id`, `playerProfileId`, `name`,
  `createdAt`, `updatedAt`. Bewusst nichts weiter (keine Position, Welt,
  Bedürfnisse, Inventar o. ä.).

Regeln:

- **Auswahl-Integrität auf Datenbankebene:** `PlayerProfile.selectedCharacterId`
  ist Teil eines zusammengesetzten Fremdschlüssels
  `(selectedCharacterId, id) → Character(id, playerProfileId)`. Die Datenbank
  erzwingt damit strukturell, dass ein Profil nur einen **eigenen** Character
  auswählen kann (NULL = keine Auswahl erlaubt; `onDelete: SetNull`).
  Zusätzlich prüft die Anwendungslogik den Besitz vor dem Setzen
  (`CHARACTER_NOT_OWNED`) — Defense in Depth, getestet auf beiden Ebenen.
- **Charakternamen sind NICHT global eindeutig.** Sie sind Anzeigenamen,
  keine Identifikatoren; Identität läuft über die UUID. (Namensregeln:
  getrimmt, 2–32 Zeichen, sonst `CHARACTER_NAME_INVALID`.)
- Die `playerProfileId` verlässt den Server nicht: `CharacterDto` enthält
  nur `id`, `name`, `createdAt`. Besitz entscheidet allein der Server aus
  dem Principal.
- Cascades: User löschen → Profile + Sessions + (via Profile) Characters
  werden mitgelöscht.

## Gründe

- Ein Account mit genau einem Profil trennt „Login" von „Spiel" ohne
  Mehrfach-Profil-Komplexität; spätere Erweiterungen (z. B. mehrere
  Spielstände) hängen dann am Profil, nicht am Account.
- Der zusammengesetzte FK macht die wichtigste fachliche Invariante der
  Auswahl zu einer strukturellen Garantie statt zu einer Konvention.
- Minimale Character-Felder verhindern, dass Zukunftsdomainen (Welt,
  Bedürfnisse, Agenten) als leere Hüllen vorweggenommen werden.

## Betrachtete Alternativen

- **Ein User-Modell mit eingebetteten Charakterdaten:** einfacher Start,
  aber unklare Begriffe und schmerzhafte Spaltung später — verworfen.
- **Einfacher FK auf `selectedCharacterId` ohne Besitzer-Constraint:**
  existenzsichernd, aber nicht besitzsichernd; die Regel läge dann
  ausschließlich in der Anwendung — für die zentrale Invariante zu schwach.
- **Global eindeutige Charakternamen:** häufige Spielerfrustration ohne
  fachlichen Nutzen in dieser Iteration — bewusst nicht gefordert.

## Konsequenzen

- Registrierung erzeugt User **und** PlayerProfile in einer Transaktion
  (zwei flache Creates; die Prisma-Engine 6.19.x verliert bei nested
  creates über der zyklischen PlayerProfile↔Character-Relation die
  UUID-Defaults des Parents — daher bewusst nicht verschachtelt).
- Die zyklische Relation (Profile↔Character) ist durch den nullbaren
  `selectedCharacterId` auflösbar: erst Profil, dann Character, dann
  Auswahl-Update.
- Jede spätere fachliche Identität (Gildenmitgliedschaft, Freundeslisten
  o. ä.) referenziert das **PlayerProfile**, jede Weltfigur den
  **Character**, jede Session den **User**.
