# x

All-in-one CLI for project cleanup, system maintenance and Kubernetes deployments.

## Usage

```bash
bun install
bun start          # watch mode
bun index.ts --help
```

Individual command groups live under `commands/`; shared helpers are in `utils/`. `bun run check` runs formatting, linting and dead-code checks.

## Deploy

```bash
bun run deploy
```

Regenerates the deployment code, applies it and upgrades the CLI.

## License

MIT
