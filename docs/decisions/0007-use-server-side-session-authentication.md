# 0007: Serverseitige Session-Authentifizierung

- **Status:** Teilweise ersetzt durch ADR 0012 und 0013
- **Datum:** 2026-07-22
- **Aktualisiert:** 2026-08-12

## Kontext

Der erste fachliche Slice (Character-Verwaltung) erfordert eine verlässliche
Antwort auf die Frage „welcher Benutzer stellt diese Anfrage?" — für REST wie
für WebSockets. Die Lösung muss lokal einfach funktionieren, darf keine
komplexe eigene Identity-Plattform sein und muss später durch OIDC / einen
externen Identity Provider ersetzbar sein, ohne die Fachlogik anzufassen.

## Entscheidung

**Serverseitige Session-Authentifizierung mit HTTP-only Cookie.**

- Registrierung/Login per E-Mail + Passwort über REST
  (`POST /api/auth/register|login|logout`, `GET /api/auth/session`).
- Passwörter werden mit **Argon2id** gehasht (OWASP-Parameter m=19 MiB, t=2,
  p=1; `@node-rs/argon2`). Klartextpasswörter werden niemals gespeichert oder
  geloggt. Bei unbekannter E-Mail wird ein gültiger statischer Dummy-Hash
  geprüft, damit der dominante Argon2-Aufwand nicht durch einen Early Return
  entfällt.
- Session = Datenbankzeile (`Session`) mit opaquem Token (256 Bit Zufall,
  base64url) als Primärschlüssel, Ablaufzeit (`SESSION_TTL_HOURS`, Standard
  24 h, fester Ablauf ohne Sliding) und User-Referenz. Ablauf wird bei jedem
  Zugriff geprüft. Zusätzlich entfernt ein indizierter Sweep abgelaufene
  Zeilen beim Start und alle 15 Minuten; der Timer wird beim Shutdown beendet
  und mit `unref()` vom Prozesslebenszyklus entkoppelt.
- Das Cookie (`city_session`) ist **HTTP-only**, `SameSite=Lax`, `Path=/`,
  mit konfigurierbarem `Secure`-Flag. Es enthält nur das Token. Produktion
  verlangt einen expliziten `CLIENT_ORIGIN` und
  `SESSION_COOKIE_SECURE=true`; andernfalls schlägt die Konfiguration beim
  Start fehl.
- Logout löscht die Session serverseitig (idempotent) und das Cookie.
- Fachlogik hängt nicht am Transport: Guards/Gateways lösen das Token über
  den `AuthService` in ein typisiertes `AuthenticatedPrincipal`
  (`userId`, `playerProfileId`, `sessionId`, `email`) auf. Clientseitig
  mitgesendete User-IDs werden niemals akzeptiert.
- **Origin-Grenze:** Unsichere REST-Methoden akzeptieren nur den exakten
  `CLIENT_ORIGIN`; dieselbe Allowlist steuert credentialed CORS,
  Socket.IO-Polling und den echten WebSocket-Handshake. Das ist der
  CSRF-Schutz für cookie-authentifizierte Commands.
- **WebSocket:** Der Handshake prüft Origin und Session-Cookie. Ohne gültige
  Session wird direkt abgelehnt. Vor jedem Protokoll-Command wird die Session
  erneut aufgelöst; Logout oder Ablauf senden einen stabilen Fehler und
  trennen auch einen bereits verbundenen Socket.
- Login-Fehler sind neutral (`INVALID_CREDENTIALS` für unbekannte E-Mail wie
  für falsches Passwort, identische Message): keine Account-Existenz-Leaks.
- Registrierung und Login besitzen getrennte prozesslokale IP-Limits vor
  Argon2 (3 bzw. 5 Requests pro Minute, `RATE_LIMITED`/429).

## Gründe

- Serverseitige Sessions sind sofort invalidierbar (Logout, Ablauf,
  später: Moderation) — JWTs im `localStorage` wären bis zum Ablauf
  unkündbar und XSS-ausgeliefert.
- HTTP-only Cookie ist für XSS nicht lesbar; `SameSite=Lax` deckt den
  lokalen Entwicklungsbetrieb über den Dev-Proxy (gleiche Site) ab.
- PostgreSQL liegt ohnehin vor; kein neuer Infrastrukturbaustein (Redis)
  für eine Iteration ohne Mehr-Server-Bedarf.
- Ablehnen beim Handshake ist einfacher zu prüfen und sicherer als
  unauthentifizierte Verbindungen, auf denen jeder zukünftige fachliche
  Command einzeln abgesichert werden müsste. Die technischen
  Protokollfunktionen (connect/connection-established) bleiben für
  authentifizierte Clients unverändert nutzbar.

## Betrachtete Alternativen

- **JWT (stateless, localStorage):** keine serverseitige Invalidierung,
  XSS-Exposition, Refresh-Logik — verworfen.
- **bcrypt statt Argon2id:** funktioniert ebenfalls mit Prebuilt-Binaries,
  aber Argon2id ist die aktuelle OWASP-Empfehlung und lief im Setup ohne
  Plattformprobleme (`@node-rs/argon2` benötigt keine Build-Skripte).
- **WebSocket verbinden, fachliche Commands einzeln ablehnen:** flexibler
  für künftige anonyme Zuschauer, aber mehr Angriffsfläche und ein
  schwerer testbarer Zwischenzustand — bei Bedarf explizit nachrüstbar.
- **Externer Identity Provider / OIDC sofort:** überdimensioniert für die
  erste Identität; bleibt durch die Principal-Abstraktion offen.

## Konsequenzen

- `SESSION_TTL_HOURS`, `SESSION_COOKIE_SECURE` und `CLIENT_ORIGIN`
  sind fail-fast validierte Sicherheitskonfiguration.
- Der Angular-Client verbindet erst nach erfolgreicher Session-Prüfung und
  trennt bei Logout. Der Server verlässt sich für aktive Sockets trotzdem
  nicht auf dieses Clientverhalten.
- Lazy Cleanup plus periodischer Sweep begrenzen das Tabellenwachstum.
- Die Revalidierung vor jedem WS-Command verursacht bewusst einen DB-Lookup;
  der kleine Slice priorisiert sofortige Revocation vor Optimierung.
- Das IP-Rate-Limit ist prozesslokal. Horizontale Skalierung erfordert einen
  gemeinsamen Store und eine bewusst konfigurierte Proxy-/Client-IP-Grenze.
- Eine spätere OIDC-Migration ersetzt AuthService und Transport;
  `AuthenticatedPrincipal` und Fachmodule bleiben unverändert.
