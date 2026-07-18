# Repository Guidelines

## Project Structure & Module Organization

`Spezifikation.md` defines the mobile-first experience, shared shopping lists, authentication, SQLite storage, and OpenAI-assisted recipe import. Runtime code lives in `src/`, tests in `tests/`, browser assets in `public/`, build helpers in `scripts/`, and schema migrations in `migrations/`. `.obsidian/` is editor metadata, not product code.

The stack is TypeScript on Node.js 26 with SQLite. Separate browser UI (`src/client`), HTTP/API code (`src/server`), domain logic, and persistence.

## Build, Test, and Development Commands

- `npm run dev` — start the local development server.
- `npm run build` — type-check and create the production build.
- `npm test` — run Node unit and integration tests.
- `npm run test:browser` — run Playwright browser tests.
- `npm run lint` — check formatting and static analysis with Biome.
- `npm run icons:generate` — refresh German product symbols from pinned Unicode CLDR data.

Keep setup reproducible and document required environment variables in `.env.example`.

## Coding Style & Naming Conventions

Use TypeScript in strict mode, two-space indentation, semicolons, and automated formatting. Prefer `camelCase` for variables and functions, `PascalCase` for types and UI components, and `kebab-case` for filenames unless the framework dictates otherwise. Keep modules focused and dependencies few. Never commit secrets, database files, uploaded photos, or generated output.

## Secrets & Local Configuration

Never read, print, search, copy, modify, or include `.env` files or their contents in tool output. The repository owner alone maintains their values. Use `.env.example` only to discover configuration property names. Ensure commands, tests, logs, and error messages do not expose secrets.

## Testing Guidelines

Choose one test runner during project setup and configure it behind `npm test`. Test files should describe observable behavior, for example `merge-lists.test.ts`. Prioritize authentication, authorization between shared lists, input validation, list merging, ordering, migrations, and failure handling around AI calls. Mock external OpenAI requests; tests must not require network access or real credentials.

## Git & Commit Guidelines

The coding agent maintains the local Git history: stage only project-related changes and commit at sensible checkpoints. Use one branch named `main`; do not create feature branches. Git provides recovery points if development goes astray.

Update GitHub only at times explicitly named by the repository owner. Do not publish, push, or open pull requests otherwise. This single-contributor project needs no review workflow. Use concise imperative commit messages with an optional scope, such as `feat(auth): add password login`. Run available checks before committing and report the commit hash.
