# x - chneau's utility CLI

This is a command-line tool for managing and deploying projects, as well as
maintaining the development system.

## Installation

```bash
bun install -g @chneau/x
```

## Usage

### `x [dir]`

The default command recursively scans a directory to perform various cleanup and
management tasks.

- **Cleans up**: Removes `yarn.lock` and `package-lock.json`.
- **Manages `package.json`**: Adds or updates scripts for upgrading, checking,
  and linting.
- **Manages `tsconfig.json`**: Enforces strict and efficient compiler options.
- **Manages `.gitignore`**: Ensures `node_modules` is ignored in Bun projects.
- **Updates dependencies**: Runs `bun upgrade` if a `package.json` is found.
- **Checks and lints**: Runs checks and linting if a `tsconfig.json` is found.

**Options:**

- `-r, --recursive [number]`: Specifies the recursion level (up to 4).

### `x fmt`

Formats all files in the current directory using `deno fmt`, `oxlint`, `biome`,
`go fmt`, and `dotnet csharpier`.

### `x deploy [json_files...] [filters...]`

Deploys applications to Kubernetes based on `.json` configuration files.

- If no `.json` files are specified, it looks for `*.json` and `.deploy.json` in
  the current directory.
- If no configuration files are found, it creates a `.deploy.json` template.
- You can filter which services to deploy by passing their names as arguments.

### `x upgrade`

Upgrades the `x` CLI to the latest version.

### `x system`

Updates and installs system packages. This command requires `sudo` privileges.

- Updates `apt` packages.
- Installs or updates `brew` and essential packages.
- Updates global `bun` packages.
- Updates dotfiles from `github.com/chneau/dotfiles`.

### `x doctor`

Checks the system for common issues and provides recommendations.

- Verifies that the user is not root and has `sudo` permissions.
- Installs missing packages.
- Configures `git`.
- Sets up dotfiles.
- Installs Docker and adds the user to the `docker` group.
- Checks for SSH keys and their configuration on GitHub.
- Configures `zsh` as the default shell.
