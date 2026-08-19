# Single-Server-Staging-Deployment

Diese Anleitung deployt genau einen Checkout mit Docker Compose auf einen
Linux-Server. Sie legt **keinen** Server, keine Domain, keine DNS-Einträge, keine
Credentials und keine Secrets an. Diese Werte und Ressourcen werden vorab
manuell bereitgestellt.

## Architektur und Sicherheitsgrenze

Caddy ist der einzige öffentlich erreichbare Container (TCP 80/443 und UDP
443). Er beschafft und erneuert das HTTPS-Zertifikat und leitet SPA-, REST- und
WebSocket-Traffic an den internen Nginx-Client weiter. Nginx reicht `/api` und
`/socket.io` einschließlich `Host`, `X-Forwarded-For` und
`X-Forwarded-Proto` an den internen Server weiter. PostgreSQL besitzt weder
einen Host-Port noch Zugang zum Edge-Netz.

`CLIENT_ORIGIN` ist die exakt browserseitig sichtbare Origin (`https://` plus
Domain, ohne Pfad und ohne abschließenden Slash). `SESSION_COOKIE_SECURE=true`
ist im Compose-Modell fest gesetzt. Eine abweichende Origin verhindert bewusst
schreibende REST-Aufrufe und WebSocket-Verbindungen.

## Voraussetzungen und manuelle Schritte

**MANUELL – vor dem ersten Start:**

1. Einen unterstützten Linux-Server mit einer nicht privilegierten
   Administrator-Anmeldung bereitstellen und Sicherheitsupdates einspielen.
2. Docker Engine mit Compose-v2-Plugin und Git nach den Anweisungen der
   jeweiligen Distribution installieren. Der ausführende Benutzer benötigt
   Zugriff auf den Docker-Daemon; dieser Zugriff entspricht Root-Rechten.
3. Firewall/Sicherheitsgruppe für SSH aus einem vertrauenswürdigen Netz sowie
   TCP 80, TCP 443 und UDP 443 aus dem Internet öffnen. PostgreSQL-Port 5432
   **nicht** öffnen.
4. Einen A- und gegebenenfalls AAAA-Eintrag der Staging-Domain auf den Server
   setzen. Vor dem Start prüfen, dass alle Records auf diesen Server zeigen.
5. Repository in beispielsweise `/opt/city-simulation` klonen. Deployment nur
   aus einem sauberen Checkout eines geprüften Commit-SHAs ausführen.
6. Einen externen, zugriffsgeschützten Speicherort und eine Aufbewahrungsregel
   für verschlüsselte Backups festlegen. Ein Backup nur auf demselben Server ist
   kein ausreichender Schutz gegen Serververlust.

Mindestens 2 CPU-Kerne, 4 GiB RAM und 20 GiB freier Speicher sind eine
konservative Startgröße, keine gemessene Kapazitätsgarantie. Speicherplatz und
Last müssen im Betrieb beobachtet werden.

## Secrets und Konfiguration

Im Deployment-Checkout:

```bash
cd /opt/city-simulation
cp .env.production.example .env.production
chmod 600 .env.production
```

**MANUELL:** `.env.production` lokal auf dem Server bearbeiten:

- `POSTGRES_PASSWORD`: langen, zufällig erzeugten Wert einsetzen;
- `DOMAIN`: nur den DNS-Namen, zum Beispiel `staging.city.example`;
- `CLIENT_ORIGIN`: exakt `https://` plus denselben Namen;
- Benutzer, Datenbankname und Session-Laufzeit bei Bedarf anpassen.

Keine echten Werte in Git, Shell-History, Tickets oder Logs kopieren. Das
Repository ignoriert `.env.production` und Varianten; die Beispieldatei enthält
nur Platzhalter. Nach einer Passwortänderung in der Datei ändert PostgreSQL das
bereits initialisierte Datenbankpasswort nicht automatisch.

Die Konfiguration ohne Start validieren:

```bash
./scripts/staging-deploy.sh check
```

`docker compose config` expandiert Secrets in seine Ausgabe. Deshalb verwendet
das Skript ausschließlich `config --quiet`; die vollständig expandierte
Konfiguration nicht in Logs oder Tickets ausgeben.

Die CI führt dieselbe statische Compose-Validierung mit den ungefährlichen
Beispielwerten aus und prüft zusätzlich, dass eine fehlende Pflichtvariable mit
einem verständlichen Hinweis abgewiesen wird. Auf Pull Requests baut sie die
Produktionsziele für Migration, Server und Client nur, wenn sich
`.dockerignore`, Compose, ein Dockerfile oder die Dateien unter `deploy/`
ändern. Läufe auf `main` und manuell gestartete Workflows bauen die Images
immer. Normale Pull Requests bleiben bei Format-, Lint- und Build-Prüfungen;
nach dem Merge beziehungsweise bei einem manuellen Lauf folgen einmalig die
Datenbankmigration und der fokussierte Browser-Smoke-Test.

## Erstinstallation

Den gewünschten, geprüften Commit explizit angeben (kein beweglicher
Branchname):

```bash
git fetch --prune origin
git show --no-patch --oneline <COMMIT_SHA>
./scripts/staging-deploy.sh deploy <COMMIT_SHA>
```

Beim Erststart baut das Skript die Images, startet PostgreSQL, führt
`prisma migrate deploy` im einmaligen `migrate`-Container aus und startet erst
danach Server, Client und Caddy. Ohne laufende Datenbank gibt es beim ersten
Start erwartungsgemäß noch kein Vorab-Backup.

Prüfen:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl --fail --show-error --silent https://staging.city.example/api/health
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 caddy migrate server
```

**MANUELL:** Beispieldomain im `curl`-Befehl ersetzen, Zertifikat im Browser
prüfen und anschließend diesen kurzen Staging-Smoke-Check durchführen:

1. In `ps` prüfen, dass `migrate` erfolgreich beendet wurde und PostgreSQL,
   Server, Client sowie Caddy gesund beziehungsweise gestartet sind.
2. `/api/health` per HTTPS abrufen und eine erfolgreiche Antwort erwarten.
3. Im Browser Registrierung oder Login, Neuladen und eine
   WebSocket-Bewegung prüfen.

Caddy kann erst nach korrektem DNS und erreichbaren Ports ein öffentliches
Zertifikat beziehen. Diese manuellen Schritte bleiben bewusst auf dem echten
Staging-Server und werden nicht als Compose-Stack oder Browser-E2E in der
Pull-Request-CI dupliziert.

## Reproduzierbares Update

Vorher den aktuell laufenden Commit und einen geprüften Ziel-Commit notieren:

```bash
cd /opt/city-simulation
git rev-parse HEAD
git fetch --prune origin
git show --no-patch --oneline <NEW_COMMIT_SHA>
./scripts/staging-deploy.sh deploy <NEW_COMMIT_SHA>
curl --fail --show-error --silent https://staging.city.example/api/health
```

Das Skript verweigert einen schmutzigen Checkout und löst das Ziel auf eine
unveränderliche Commit-ID auf. Bei einer laufenden Datenbank schreibt es vor
dem Checkout automatisch ein Backup nach `backups/`, baut ohne Build-Cache-
Annahmen mit aktuellem Basis-Image (`--pull`) und startet den Stack. Den
erzeugten Backup-Pfad und beide Commit-SHAs im Deployment-Protokoll festhalten,
aber keine Secret-Werte protokollieren.

## Backup

Ein zusätzliches konsistentes Custom-Format-Backup erstellen:

```bash
./scripts/staging-deploy.sh backup
find backups -type f -name '*.dump' -size +0 -print
```

Das Backup erhält Modus 600 über `umask 077`. **MANUELL:** Die Datei
verschlüsselt an den externen Backup-Ort übertragen, Prüfsumme verifizieren,
Aufbewahrungsregel anwenden und regelmäßige Restore-Tests auf einer isolierten
Datenbank durchführen. Die `.env.production` beziehungsweise deren Secret-Werte
separat in einem Secret-Manager sichern; sie sind nicht Teil des Dumps.

## Wiederherstellung

Die Wiederherstellung überschreibt Daten und ist deshalb absichtlich nicht im
Deployment-Skript automatisiert. Zuerst Wartungsfenster ankündigen und den
ausgewählten Dump extern verifizieren.

```bash
cd /opt/city-simulation
docker compose --env-file .env.production -f docker-compose.prod.yml stop caddy client server migrate
./scripts/staging-deploy.sh backup backups/before-restore.dump
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c \
  'dropdb --if-exists --force --username="$POSTGRES_USER" "$POSTGRES_DB" && createdb --username="$POSTGRES_USER" "$POSTGRES_DB"'
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c \
  'pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < backups/<VERIFIED_BACKUP>.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

**MANUELL:** `<VERIFIED_BACKUP>` und die Domain in den Health-/Smoke-Checks
ersetzen. Anschließend `ps`, `/api/health`, Login und World-Reconnect prüfen.
Den Stack während der Wiederherstellung nicht öffentlich erreichbar lassen.

## Rollback

Ein Anwendungs-Rollback ist ein Deployment des zuvor notierten Commit-SHAs:

```bash
./scripts/staging-deploy.sh deploy <PREVIOUS_COMMIT_SHA>
curl --fail --show-error --silent https://staging.city.example/api/health
```

Prisma-Migrationen werden dadurch **nicht** rückgängig gemacht. Ein altes Image
darf nur gegen das aktuelle Schema gestartet werden, wenn die dazwischen
liegenden Migrationen rückwärtskompatibel sind. Andernfalls im Wartungsfenster
den Stack stoppen, den unmittelbar vor dem Update erzeugten Dump wie oben
wiederherstellen und anschließend den vorherigen Commit deployen. Dadurch gehen
alle seit diesem Backup geschriebenen Daten verloren; diese Entscheidung ist
ein **MANUELLER** Freigabeschritt.

Niemals `docker compose down --volumes` als Rollback verwenden: Der Befehl
löscht Datenbank- und Caddy-Volumes. Normales `docker compose down` oder
Container-Neustarts behalten sie.

## Betrieb und Diagnose

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 server caddy
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_isready -U city -d city_simulation
curl --fail --show-error --silent https://staging.city.example/api/health
```

**MANUELL:** Verfügbarkeit, Zertifikatsablauf, Plattenplatz, Backup-Erfolg und
Anwendungsfehler extern überwachen. Betriebssystem-, Docker- und Caddy-Updates
regelmäßig in einem Wartungsfenster einspielen. Diese Repository-Automation
erstellt weder Monitoring noch Alarmierung und implementiert bewusst keine
Multi-Server-, Cloud- oder sonstige Roadmap-Funktionalität.
