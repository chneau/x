# x - Utility CLI

A command-line tool for project management, system maintenance, and Kubernetes
deployment.

## Installation

```bash
bun install -g @chneau/x
```

## Usage

### Project Management

```bash
x [dir] [-r depth]
```

Recursively scans directories to:

- Clean lock files (`yarn.lock`, `package-lock.json`).
- Enforce `tsconfig.json` and `package.json` standards.
- Update `.gitignore` for Bun projects.
- Run `bun upgrade`, `check` (lint), and `lint` (tsc).

### Formatting

```bash
x fmt
```

Formats files using `deno fmt`, `oxlint`, `biome`, `go fmt`, and
`dotnet csharpier`.

### Deployment

```bash
x deploy [files...] [services...]
```

Deploys to Kubernetes using JSON configuration.

- Supports environment variable substitution and service inheritance.
- Builds and pushes Docker images if registries are configured.
- Generates a template `.deploy.json` if no configuration is found.

### System Setup

```bash
x doctor [--email <email>] [--name <name>] [--no-updates]
```

Sets up the development environment (Linux/Windows):

- Installs system tools (`git`, `docker`, `go`, `node`, `deno`, `kubectl`,
  etc.).
- Configures Git, SSH keys, and GitHub authentication.
- Installs dotfiles and configures shell (Zsh).
- Updates system packages (`apt`, `brew`, `bun`).

### Self Update

```bash
x upgrade
```

Updates `x` to the latest version.
