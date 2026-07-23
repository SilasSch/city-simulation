# 0007: Serverseitige Session-Authentifizierung

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

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
  p=1; `@node-rs/argon2` mit vorgefertigten Binärpaketen). Klartextpasswörter
  werden niemals gespeichert oder geloggt.
- Session = Datenbankzeile (`Session`) mit opaquem Token (256 Bit Zufall,
  base64url) als Primärschlüssel, Ablaufzeit (`SESSION_TTL_HOURS`, Standard
  24 h, fester Ablauf ohne Sliding) und User-Referenz. Ablauf wird bei jedem
  Zugriff geprüft; abgelaufene Sessions werden dabei gelöscht (lazy cleanup).
- Das Cookie (`city_session`) ist **HTTP-only**, `SameSite=Lax`, `Path=/`,
  mit konfigurierbarem `Secure`-Flag (`SESSION_COOKIE_SECURE`, lokal `false`,
  produktiv `true`). Es enthält nur das Token — keine fachlichen Daten.
- Logout löscht die Session serverseitig (idempotent) und das Cookie.
- Fachlogik hängt nicht am Transport: Guards/Gateways lösen das Token über
  den `AuthService` in ein typisiertes `AuthenticatedPrincipal`
  (`userId`, `playerProfileId`, `sessionId`, `email`) auf. Clientseitig
  mitgesendete User-IDs werden niemals akzeptiert.
- **WebSocket:** der Socket.IO-Handshake prüft das Session-Cookie in einer
  Middleware. **Ohne gültige Session wird die Verbindung abgelehnt**
  (Variante „direkt ablehnen"). Fachliche Commands setzen damit immer ein
  Principal voraus; es gibt keinen halb-authentifizierten Zustand.
- Login-Fehler sind neutral (`INVALID_CREDENTIALS` für unbekannte E-Mail wie
  für falsches Passwort, identische Message): keine Account-Existenz-Leaks.

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

- Neue Konfiguration: `SESSION_TTL_HOURS`, `SESSION_COOKIE_SECURE`
  (validiert in `apps/server/src/core/config.ts`).
- Der Angular-Client verbindet den WebSocket erst nach erfolgreicher
  Session-Prüfung und trennt bei Logout.
- Session-Tabellenwachstum wird durch lazy cleanup beim Zugriff begrenzt;
  ein späterer Sweep-Job ist trivial ergänzbar.
- Migration zu OIDC später: nur `AuthService` + Transport (Cookie/Middleware)
  werden ersetzt; `AuthenticatedPrincipal` und alle Fachmodule bleiben
  unverändert.
