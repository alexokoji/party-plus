/**
 * Runs the web app and the room Worker together.
 *
 * Online play needs both: rooms live in a Cloudflare Durable Object served by
 * `wrangler dev`, separate from Next. Starting only `npm run dev` leaves every
 * room stuck trying to reach a server that isn't there, which is confusing
 * enough that it deserves a single command.
 */
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

const targets = [
  { name: "web  ", color: "\x1b[36m", cmd: "npx", args: ["next", "dev"] },
  { name: "rooms", color: "\x1b[35m", cmd: "npx", args: ["wrangler", "dev", "--port", "8787", "--local"] },
];

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const target of targets) {
  const child = spawn(target.cmd, target.args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    env: process.env,
  });
  children.push(child);

  const prefix = `${target.color}[${target.name}]\x1b[0m `;
  const write = (stream) => (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) stream.write(prefix + line + "\n");
    }
  };
  child.stdout.on("data", write(process.stdout));
  child.stderr.on("data", write(process.stderr));

  child.on("exit", (code) => {
    if (shuttingDown) return;
    process.stderr.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("web app:     http://localhost:3000");
console.log("room worker: ws://127.0.0.1:8787");
console.log("(ctrl-c stops both)\n");
