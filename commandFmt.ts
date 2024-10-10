import { $ } from "bun";

export const commandFmt = async () =>
	void (await Promise.all([
		$`deno fmt --use-tabs --quiet; oxlint --fix-dangerously --quiet; biome check --write --unsafe .`.nothrow(),
		$`go fmt ./...`.nothrow(),
		$`dotnet csharpier .`.nothrow(),
	]));
