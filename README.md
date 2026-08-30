# x - Utility CLI

A powerful, all-in-one command-line tool for project management, system
maintenance, and Kubernetes deployment.

## Installation

```bash
bun install -g @chneau/x
```

## Usage

Running `x` or `x --help` displays all available commands.

### Project Sanitization & Modernization

```bash
x purify [dir] [-r|--recursive <depth>] [-d|--dry-run]
```

Recursively scans directories (up to depth 4) to:

- **Clean up:** Removes `yarn.lock` and `package-lock.json` in favor of Bun.
- **Enforce Standards:** Updates `package.json` with standard scripts
  (`upgrade`, `check`, `lint`, `all`) and `tsconfig.json` with strict compiler
  options.
- **Git Integration:** Ensures `.gitignore` includes `node_modules` for Bun
  projects.
- **Auto-Maintenance:** Runs `bun run upgrade`, `bun run check`, and
  `bun run lint` automatically.
- **Dry-run Mode:** Use `-d` / `--dry-run` to preview all actions safely without
  making changes.

### Git Clean & Maintenance

```bash
x gitclean [dir] [-r|--recursive <depth>] [-c|--concurrency <workers>]
```

Finds git repositories in parallel (up to recursion depth) and performs full
cleanup:

- `git reflog expire --expire=now --all`
- `git repack -ad`
- `git prune`
- `git fetch --prune --prune-tags`
- `GIT_ASK_YESNO=false git clean -ffdx`

Concurrency defaults to 10 workers, and recursion depth defaults to 1.

### Project Initialization

```bash
x init [dir] [-t|--template <template-name|repo>]
# Aliases: x create, x new
```

Initializes a new project (in current directory or specified target `[dir]`):

- **Template support:** If specified, fetches the template via `degit` (supports
  templates configured in config like `web` (`web-orpc`) / `web-hono` or a full
  git repository URL).
- **Default init:** Otherwise, runs `bun init -y`.
- **Scripts & Standards:** Automatically runs `purify` to set up standard
  scripts and configurations.
- **Files:** Configures basic `README.md` and `.gitignore`.

### Code Formatting

```bash
x format
# Alias: x fmt
```

Formats files across different languages using:

- **Web:** `deno fmt`, `oxlint`, `biome`.
- **Go:** `go fmt ./...`.
- **C#:** `dotnet csharpier`.

### Deployment

```bash
x deploy [files...] [services...]
```

Deploys to Kubernetes using JSON configuration (e.g., `.deploy.json`).

- **Substitution:** Supports environment variable substitution.
- **Docker:** Handles Docker login, builds, and pushes images to configured
  registries.
- **CDK8s:** Generates Kubernetes manifests and applies them via `kubectl`.
- **Templates:** Generates a `.deploy.json` template if no configuration is
  found.

### Helm Chart Management

```bash
x helm [releases...] [-u|--upgrade] [-a|--all]
```

Scans and checks Helm charts in the current Kubernetes context:

- **Check all releases**: `x helm`
- **Check specific releases**: `x helm ingress-nginx` or
  `x helm cert-manager harbor`
- **Upgrade specific release**: `x helm ingress-nginx -u`
- **Upgrade all passing releases**: `x helm -u -a`

Performs async repo discovery, validates client dry-run (`--dry-run=client`) and
server dry-run (`--dry-run=server`), and upgrades only if dry runs succeed (or
reports failure details).

```bash
x doctor [-e|--email <email>] [-n|--name <name>] [--no-updates]
```

Sets up and maintains your development environment (Linux/Windows):

- **Package Managers:** Updates `apt`, `brew`, and `bun`.
- **Tools:** Installs essential tools including `git`, `docker`, `go`, `deno`,
  `dotnet`, `uv`, `kubectl`, `lazygit`, and many Bun-based utilities.
- **Configuration:** Sets up dotfiles (`.zshrc`, `.bashrc`, etc.), SSH keys,
  Git, and GitHub authentication.
- **Shell:** Configures Zsh as the default shell and ensures Docker group
  permissions.

### Self Update

```bash
x upgrade
```

Updates `x` to the latest version.
