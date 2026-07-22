# 0005: PostgreSQL + Prisma

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

Die persistente Welt braucht eine relationale, transaktionssichere Datenbank.
Lokal soll alles per Docker Compose starten. Das Schema soll erst mit echten
Features wachsen — keine spekulativen Tabellen.

## Entscheidung

PostgreSQL 16 (Docker Compose) + Prisma 6 als ORM mit Migrationen.
Das Schema enthält aktuell **keine** Modelle; der Verbindungsnachweis erfolgt
über den Health-Check (`SELECT 1` via `PrismaService`). Die erste fachliche
Tabelle entsteht mit dem ersten fachlichen Feature als echte Migration.

Prisma wird bewusst auf Version 6 gepinnt: Version 7 (aktuelles `latest`)
verlangt ein neues Konfigurationsmodell (`prisma.config.ts`, Driver-Adapters),
das zum Setup-Zeitpunkt noch keinen Mehrwert bietet.

## Gründe

- PostgreSQL: Standard für relationale Persistenz, JSONB für spätere
  flexible Weltzustände, ausgereifte Werkzeuge.
- Prisma: typisierter Client, deklarative Migrationen, gute NestJS-Integration.
- `PrismaService` ist der einzige DB-Zugangspunkt und lässt sich in Tests
  einfach mocken.

## Betrachtete Alternativen

- **TypeORM:** ältere NestJS-Standardwahl, aber schwächere Typsicherheit und
  Migrationen.
- **Drizzle:** leichtgewichtig und modern, aber kleineres Ökosystem;
  bei Bedarf spätere Neubewertung möglich.
- **SQLite:** zu wenig für eine persistente Multiplayer-Welt (Concurrency).
- **Prisma 7 sofort:** neues Config-Modell ohne aktuellen Nutzen; Upgrade wird
  separat geplant, sobald es stabil und relevant ist.

## Konsequenzen

- Migrationen laufen via `pnpm db:migrate` (lokal) und in der CI gegen ein
  echtes PostgreSQL-Service-Container.
- Fachliche Queries gehören in Services/Module, nie in Transport-Schichten.
