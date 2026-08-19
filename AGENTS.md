# Agent instructions

## Validation policy

This project is still in an early iteration phase. Optimize for short feedback loops.

- Run only the smallest check that covers the files and behavior changed.
- For documentation or configuration-only changes, do not run application tests.
- For a localized client or server change, prefer the affected Nx target or a single relevant test file.
- Add tests only for stable domain rules, security boundaries, or a reproduced regression. Do not build broad regression suites for exploratory UI or gameplay work.
- Do not run `pnpm test`, `pnpm e2e`, the full `pnpm build`, Docker/Compose stacks, or Playwright browser installation unless the task explicitly requires it or they are necessary to reproduce a failure.
- Do not repeat repository-wide checks locally after GitHub CI has already covered them.
- After pushing, rely on GitHub CI for repository-wide validation. Report skipped checks clearly in the pull request.

Examples:

- Documentation: inspect the rendered Markdown and optionally run Prettier on the changed files.
- UI/map work: build the affected client target and perform a short manual check.
- Server rule: run only the focused unit test for that rule.
- Multiplayer/gameplay flow: perform a short manual two-browser check unless the issue explicitly requires automation.
