# Repository Guidelines

## Project Structure & Module Organization

This repository is specification-first. `Spezifikation.md` defines the mobile-first experience, shared shopping lists, authentication, SQLite storage, and planned OpenAI-assisted recipe import. `.obsidian/` contains editor metadata, not product code.

The intended stack is TypeScript, Node.js, and SQLite with minimal dependencies. Keep runtime code under `src/`, tests beside their subjects as `*.test.ts` or under `tests/`, static images under `public/`, and database migrations under `migrations/`. Separate browser UI, API handling, domain logic, and persistence.

## Build, Test, and Development Commands

No package manifest or executable application exists yet, so there are no build or test commands. When bootstrapping, expose the workflow through `package.json`:

- `npm run dev` — start the local development server.
- `npm run build` — type-check and create the production build.
- `npm test` — run the complete automated test suite.
- `npm run lint` — check formatting and static-analysis rules.

Keep setup reproducible from a clean checkout and document required environment variables in `.env.example`.

## Coding Style & Naming Conventions

Use TypeScript in strict mode, two-space indentation, semicolons, and automated formatting. Prefer `camelCase` for variables and functions, `PascalCase` for types and UI components, and `kebab-case` for filenames unless the framework dictates otherwise. Keep modules focused and dependencies few. Never commit secrets, database files, uploaded photos, or generated output.

## Testing Guidelines

Choose one test runner during project setup and configure it behind `npm test`. Test files should describe observable behavior, for example `merge-lists.test.ts`. Prioritize authentication, authorization between shared lists, input validation, list merging, ordering, migrations, and failure handling around AI calls. Mock external OpenAI requests; tests must not require network access or real credentials.

## Git & Commit Guidelines

The coding agent is responsible for maintaining this project's local Git history: initialize Git if needed, stage only project-related changes, and create focused commits at sensible checkpoints. Use one branch named `main`; do not create feature branches. Git primarily provides recovery points so work can return to a known-good state if development goes astray.

Update or push to GitHub only at times explicitly named by the repository owner. Do not publish, push, or open pull requests without that instruction. This is a single-contributor project, so review and pull-request workflows are unnecessary. Use concise imperative commit messages with an optional scope, such as `feat(auth): add password login` or `docs: clarify list merging`. Run available checks before committing and report the resulting commit hash.
