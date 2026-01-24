# Repository Guidelines

## Project Structure & Module Organization
- `index.js` is the CLI entry point and wires `commander` to the dispatcher.
- `src/altd.js` contains the core AccessLogTailDispatcher implementation.
- `test/*.test.js` holds Vitest suites (e.g., `test/altd.test.js`).
- `scripts/build.js` produces the `dist/` build output used by npm.

## Build, Test, and Development Commands
- `npm run build` generates `dist/index.js` and `dist/altd.js` for publishing.
- `npm test` runs Vitest in CI mode with coverage.
- `npm run test:watch` runs Vitest in watch mode for local iteration.

## Coding Style & Naming Conventions
- JavaScript is ESM (`"type": "module"`) and targets Node.js 18+.
- Use 2-space indentation and semicolons; follow the quote style of the file you are editing.
- Keep function and variable names descriptive and camelCase (`buildRegistry`, `maxPartLength`).
- No linting/formatting tools are configured; keep diffs focused and readable.

## Testing Guidelines
- Tests are written with Vitest and live under `test/` with `*.test.js` names.
- Add or update tests for behavior changes; use `npm test` before PRs.
- Coverage is collected via `@vitest/coverage-v8`; aim to keep new code covered.

## Commit & Pull Request Guidelines
- Commit messages in this repo are short, imperative, and sentence case (e.g., `Fix util.isArray deprecation warning`).
- PRs should include a clear description, relevant issue links, and test results.
- If behavior changes affect CLI usage, update `README.md` examples.

## Security & Configuration Notes
- Commands are executed exactly as whitelisted; there is no PATH resolution or argument validation.
- Treat access logs as trusted input, and keep whitelists explicit (e.g., `-w /bin/ls,/usr/bin/hostname`).
