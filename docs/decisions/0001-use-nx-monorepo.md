# 0001: Nx-Monorepo mit pnpm

- **Status:** Akzeptiert
- **Datum:** 2026-07-22

## Kontext

Client (Angular), Server (NestJS) und gemeinsame Verträge (Zod-Schemas) müssen
konsistent versioniert und gemeinsam gebaut, gelintet und getestet werden.
Ohne gemeinsames Repo driften Netzwerkverträge auseinander.

## Entscheidung

Ein Nx-Monorepo mit pnpm als Package Manager. Apps unter `apps/`, gemeinsame
Libraries unter `libs/`, zentrale Nx-Tasks für build/lint/test/serve.

## Gründe

- Client und Server importieren dieselben Schemas aus `libs/game-protocol` —
  eine einzige Quelle der Wahrheit für das Protokoll.
- Nx-Cache und Task-Graph (`dependsOn`) halten die Feedbackschleife klein.
- pnpm: schnell, platzeffizient, strikte `node_modules` (fehlende Deps fallen
  sofort auf).
- Keine zweite Monorepo-Lösung (kein Turborepo, kein Lerna) nötig.

## Betrachtete Alternativen

- **Zwei Repos + npm-Package für Verträge:** Veröffentlichungs-Overhead für
  jede Protokolländerung — für ein Zwei-Personen-Projekt unverhältnismäßig.
- **Ein Repo ohne Monorepo-Tooling:** kein Task-Caching, kein Projektgraph,
  keine durchsetzbaren Importgrenzen.
- **Turborepo:** vergleichbar, aber Nx bringt Generatoren, ESLint-Modulgrenzen
  und Angular-/Nest-Plugins mit.

## Konsequenzen

- Alle Änderungen an Protokoll, Client und Server laufen durch dieselbe CI.
- `@nx/enforce-module-boundaries` ist Teil des Lintings und muss grün bleiben.
- pnpm-spezifische Eigenheiten (`allowBuilds`/`onlyBuiltDependencies` in
  `pnpm-workspace.yaml`) sind dokumentiert und gepflegt.
