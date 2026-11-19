import { spawn } from "node:child_process";
import { resolve } from "node:path";

const child = spawn(
  "python3",
  ["tools/product-image-studio/bootstrap.py", "--run-server", ...process.argv.slice(2)],
  {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, PRODUCT_IMAGE_NODE: process.execPath },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", () => {
  console.error("Python konnte nicht gestartet werden.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
