# Repository Guidelines

## Project Structure & Module Organization

This repository is specification-first. `Spezifikation.md` defines the mobile-first experience, shared shopping lists, authentication, SQLite storage, and planned OpenAI-assisted recipe import. `.obsidian/` contains editor metadata, not product code.

The intended stack is TypeScript, Node.js, and SQLite. Keep runtime code under `src/`, tests as `*.test.ts` or under `tests/`, static images under `public/`, and migrations under `migrations/`. Separate UI, API, domain logic, and persistence.

## Build, Test, and Development Commands

No package manifest or executable application exists yet, so there are no build or test commands. When bootstrapping, expose the workflow through `package.json`:

- `npm run dev` — start the local development server.
- `npm run build` — type-check and create the production build.
- `npm test` — run the complete automated test suite.
- `npm run lint` — check formatting and static-analysis rules.

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
