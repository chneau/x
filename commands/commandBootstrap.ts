import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "../utils/verboseShell";

export const commandBootstrap = async () => {
  const home = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "";
  if (!home) {
    console.error("❌ Could not determine home directory");
    process.exit(1);
  }
  const dir = join(home, "dotfiles");
  if (existsSync(dir)) {
    console.log(`🔄 Updating ${dir}...`);
    await $`git -C ${dir} pull`;
  } else {
    console.log(`📦 Cloning chneau/dotfiles into ${dir}...`);
    await $`git clone https://github.com/chneau/dotfiles ${dir}`;
  }

  if (process.platform === "win32") {
    await $`pwsh -NoProfile -ExecutionPolicy Bypass -File ${join(dir, "bootstrap.ps1")}`;
  } else {
    await $`bash ${join(dir, "bootstrap.sh")}`;
  }
};
