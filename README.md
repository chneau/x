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

- **Cleans up**: Removes `yarn.lock` and `package-lock.json` (enforcing Bun).
- **Manages `package.json`**: Adds or updates scripts for upgrading, checking,
  and linting.
- **Manages `tsconfig.json`**: Enforces strict and efficient compiler options.
- **Manages `.gitignore`**: Ensures `node_modules` is ignored in Bun projects.
- **Updates dependencies**: Runs `bun upgrade` if a `package.json` is found.
- **Checks and lints**: Runs checks and linting if a `tsconfig.json` is found.

**Options:**

- `-r, --recursive [number]`: Specifies the recursion level (up to 4).

### `x fmt`

Formats all files in the current directory using:

- `deno fmt`
- `oxlint`
- `biome`
- `go fmt`
- `dotnet csharpier`

### `x deploy [json_files...] [filters...]`

Deploys applications to Kubernetes based on `.json` configuration files.

- If no `.json` files are specified, it looks for `*.json` and `.deploy.json` in
  the current directory.
- If no configuration files are found, it creates a `.deploy.json` template.
- You can filter which services to deploy by passing their names as arguments.

### `x upgrade`

Upgrades the `x` CLI to the latest version.

### `x doctor`

Checks the system for common issues, installs dependencies, and performs
updates.

**Features:**

- **System Updates**: Updates `apt`, `brew`, and global `bun` packages (can be
  disabled with `--no-updates`).
- **Package Installation**: Installs essential tools including:
  - System: `git`, `curl`, `zsh`, `docker`, `gcc`, `make`
  - Runtimes: `go`, `node`, `deno`, `openjdk`
  - Utils: `kubectl`, `helm`, `lazygit`, `biome`, `oxlint`, and more.
- **Configuration**:
  - Configures `git` (email/name).
  - Sets up SSH keys and ensures they are on GitHub.
  - installs and configures dotfiles from `github.com/chneau/dotfiles`.
  - Configures `zsh` as the default shell.
  - Adds user to `docker` group.
  - **Windows Support**: On Windows, the `doctor` command utilizes `winget` for
    installing system tools and `bun` for managing other packages, ensuring a
    tailored setup for the environment.

**Options:**

- `--email <email>`: Git email address (default: "charles63500@gmail.com").
- `--name <name>`: Git name (default: "chneau").
- `--no-updates`: Skip system package updates.
