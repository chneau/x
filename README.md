# x - Utility CLI

A powerful, all-in-one command-line tool for project management, system
maintenance, and Kubernetes deployment.

## Installation

```bash
bun install -g @chneau/x
```

## Usage

### Project Management

```bash
x [dir] [-r depth]
```

Recursively scans directories (up to depth 4) to:

- **Clean up:** Removes `yarn.lock` and `package-lock.json` in favor of Bun.
- **Enforce Standards:** Updates `package.json` with standard scripts
  (`upgrade`, `check`, `lint`, `all`) and `tsconfig.json` with strict compiler
  options.
- **Git Integration:** Ensures `.gitignore` includes `node_modules` for Bun
  projects.
- **Auto-Maintenance:** Runs `bun upgrade`, `check` (lint), and `lint` (tsc)
  automatically.

### New Project

```bash
x new
```

Initializes a new Bun project in the current directory:

- Runs `bun init -y`.
- Sets up standard `package.json` scripts.
- Configures basic `README.md` and `.gitignore`.
- Automatically runs `x` to enforce standards.

### Formatting

```bash
x fmt
```

Formats files across different languages using:

- **Web:** `deno fmt`, `oxlint`, `biome`.
- **Go:** `go fmt`.
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

### System Setup (Doctor)

```bash
x doctor [--email <email>] [--name <name>] [--no-updates]
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
