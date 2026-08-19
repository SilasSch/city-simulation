# 0012: Gemeinsame PostgreSQL-Buckets für Auth-Rate-Limits

- **Status:** Akzeptiert
- **Datum:** 2026-08-19
- **Ersetzt:** die prozesslokalen Rate-Limits aus ADR 0007

## Kontext

Prozesslokale Login-Limits lassen sich durch Verteilung auf Replikate umgehen.
Gleichzeitig darf eine falsch vertraute `X-Forwarded-For`-Kette Angreifern
nicht erlauben, beliebige Client-IPs vorzutäuschen.

## Entscheidung

- Fixed-Window-Buckets werden atomar in PostgreSQL inkrementiert.
- Persistiert werden nur SHA-256-Schlüssel, keine Klartext-IP oder E-Mail.
- Registrierung wird je IP begrenzt. Login kombiniert ein grobes IP-Limit mit
  einem engeren Bucket aus IP und normalisierter E-Mail.
- Abgelaufene Buckets werden opportunistisch entfernt.
- Express verwendet ausschließlich `request.ip`. `TRUST_PROXY_HOPS` ist in
  Produktion explizit Pflicht; lokal gilt 0, im Compose-Stack genau 1.

## Betrachtete Alternativen

- **In-Memory-Map:** schnell, aber pro Replikat isoliert.
- **Redis:** geeignet, würde für diesen modularen Monolith jedoch einen neuen
  Betriebsdienst nur für wenige kleine Buckets einführen.
- **Beliebiges Forwarded-Header-Vertrauen:** ermöglicht IP-Spoofing.

## Konsequenzen

- Alle Server-Replikate teilen dieselben Grenzen und Fehlercodes.
- Jeder Auth-Versuch verursacht eine kleine atomare Datenbankoperation.
- Änderungen an der Proxy-Topologie erfordern eine bewusste Anpassung der
  Vertrauensgrenze und einen Deployment-Test.
