# x — Agent & Engineering Handbook

Single source of truth for AI agents and engineers in the **x** repository (a
Bun + TypeScript utility CLI). Read it before touching code.

Sections: 0 Code Is the Source of Truth · 1 How Agents Work Here · 2 Layout · 3
TypeScript & Coding Standards · 4 Modern APIs · 5 Runtime & Package Manager (Bun
Only) · 6 Verification

---

## 0. Code Is the Source of Truth

The repository has **no documentation files and no comments**: the code — names,
types, structure — is the only specification. This section overrides every other
section and is enforced in review.

- **FORBIDDEN**: committing `*.md` / `*.mdx` files or a `docs/` tree. The only
  exception is `AGENTS.md` (this handbook).
- **FORBIDDEN**: adding any comment — line, block, doc, XML-doc, section banner
  (`// ----`, `// ====`), explanatory note in any language. If a comment feels
  necessary, the code is not explicit enough.
- **REQUIRED**: make the code explicit enough to be read without prose —
  descriptive names, small single-purpose functions, precise domain types, and a
  string built from its parts rather than a literal carrying an invisible
  character.
- **DELETED documentation stays deleted**; do not recreate it, and never add a
  `README.md` to this repository.
- **ALLOWED** comments are only toolchain-consumed directives that cannot be
  expressed otherwise: `@ts-expect-error` / `@ts-ignore` / `@ts-nocheck`,
  `eslint-disable*` / `biome-ignore` / `oxlint-disable`, `# noqa` /
  `# type: ignore`, PEP 723 `# /// script` blocks, shellcheck directives,
  Dockerfile `# syntax=` / `# escape=`, shebangs. Keep them minimal and delete
  any that no longer bite — prefer rewriting the code over suppressing a rule.

---

## 1. How Agents Work Here

- **Git cleanliness**: **FORBIDDEN** to stage, commit, push, or open a PR
  without explicit user instruction in the current conversation. Leave changes
  in the working tree.
- **Issues**: **FORBIDDEN** to create a GitHub issue unless the user explicitly
  asked for it. Report extra findings in your reply instead.
- **Tooling**: exclude `node_modules` and gitignored files/directories from
  every search, and prefer targeted tools (ripgrep / `grep` / `glob`) over
  manual scanning.
- **Verification**: read §6 before claiming a change is done.

---

## 2. Layout

Every command is one file in `commands/` exporting a `Command` from
`@commander-js/extra-typings`; `index.ts` is the root program that registers
them and holds the only shebang in the repo. Shared helpers live in `utils/`.
`config.json` is user-facing data (templates, dotfiles, package sources, doctor
steps) read at runtime; `deployment-schema.json` describes `.deploy.json`.
`_gen.ts` regenerates `deployment-schema.json` from the deploy zod schema;
`_deploy.ts` builds `dist/x.js` and publishes it, and `bun run deploy` chains
both and upgrades the installed CLI.

---

## 3. TypeScript & Coding Standards

- **Zero `any` & strict typing**: **FORBIDDEN** — `any`, `as any`,
  `Record<string, any>`, `as unknown as T`, and the non-null assertion `!`
  (`foo!`). **REQUIRED** — explicit domain `type` models for payloads, config
  and component states. Dynamic data uses strictly typed generics or type
  predicates; avoid `as` assertions unless strictly necessary.
- **Type aliases over interfaces**: **FORBIDDEN** `interface Foo { ... }`;
  **REQUIRED** `type Foo = { ... };`.
- **Const arrow functions over declarations**: **FORBIDDEN**
  `function doSomething() { ... }`; **REQUIRED**
  `const doSomething = () => { ... };`.
- **Named exports over defaults**: **FORBIDDEN** `export default Foo;` (except
  config files strictly mandated by external tools); **REQUIRED**
  `export const Foo = ...;`.
- **Null safety & indexing**: safely handle `undefined` from array/dictionary
  indexing (optional chaining `?.`, truthiness guards, fallback values) to
  satisfy `noUncheckedIndexedAccess`.
- **Clean code & inference**: no unused imports, locals or parameters
  (`noUnusedLocals` / `noUnusedParameters`; prefix a required unused parameter
  with `_`). Do not over-type callback parameters whose types are inferred
  (`map`, `filter`), and omit return types TypeScript infers correctly.
- **Errors**: throw standard `Error` instances with an actionable message; a
  command that fails exits non-zero and prints the reason, and a command that
  mutates the machine defaults to a dry run and needs an explicit flag to act.

---

## 4. Modern API Standards

Zod (v4): **FORBIDDEN** `z.string().uuid()`, `z.string().url()`,
`z.string().datetime()`, `z.string().email()`; **REQUIRED** `z.uuid()`,
`z.url()`, `z.iso.datetime()`, `z.email()` respectively.

---

## 5. Runtime & Package Manager Standards (Bun Only)

- **FORBIDDEN**: `npm`, `npx`, `yarn`, `pnpm`. Never invoke them or recommend
  them to the user.
- **REQUIRED**: `bun` and `bun x` (`bun run check`, `bun install`, `bun add`,
  `bun x <tool>`, `bun --watch`), with `deno fmt` for formatting.
- **Exception**: `x pyup` targets `uv` for the Python scripts it rewrites — that
  is the tool's own domain, not a general package-manager exception.

---

## 6. Verification

`bun run check` is the style, typing and dead-code gate, and it **rewrites
files** — including files unrelated to your change — because every step
auto-fixes. Accept the formatter output: include it in your commit, never
`git restore` / `git checkout --` it, and never hand-edit formatting to match
your own preference. Target exit `0` with no errors and no warnings.

```bash
bun run check      # check:clean, deno fmt, oxlint, biome, ts-unused-exports, tsc
bun run lint       # tsc --noEmit only
bun run all        # upgrade (bun update --latest) then check
```

- Indentation is **tabs**; `deno fmt --use-tabs` and biome both enforce it.
- The `biome check --write --unsafe` step runs under `timeout 3s`: a fired
  timeout kills biome mid-rewrite and leaves the file it was writing truncated.
  If files look truncated after a run, that is why — re-run on an idle machine.
- `oxlint --fix-dangerously` deletes whole declarations, not just comments, and
  takes its ignore set from the repository-root `.gitignore`: a partial checkout
  that lacks that file can have `node_modules` rewritten. Review its output, and
  never run it outside the repository root.
- `--no-exit-on-error` in the `check` script means "keep going after a failing
  step", **not** "hide it": a failed step still makes `bun run check` exit `1`.
  Read the exit code and the output.
- Neither `tsc`, `biome` nor `oxlint` replaces reading the code. A stale read —
  a value read outside where it is refreshed — type-checks, lints and formats
  cleanly while being plainly broken at runtime.
- There is no test runner in this repository. Run the command you touched
  (`bun start`, then `x <command> --help` and a real invocation) before claiming
  a change works; a changed command must still register and parse.
