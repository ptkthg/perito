// Espelha .agents/skills (fonte canônica, lida pelo Codex) em .claude/skills (Claude Code).
// Uso: node scripts/sync-skills.mjs [--check]
//   --check: não escreve; sai com código 1 se houver diferença (útil em CI/pre-commit).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, ".agents", "skills");
const dst = join(root, ".claude", "skills");
const check = process.argv.includes("--check");

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const srcFiles = new Map(walk(src).map((p) => [relative(src, p), readFileSync(p)]));
const dstFiles = new Map(walk(dst).map((p) => [relative(dst, p), readFileSync(p)]));

const diffs = [];
for (const [rel, buf] of srcFiles) {
  const other = dstFiles.get(rel);
  if (!other || !other.equals(buf)) diffs.push(`~ ${rel}`);
}
for (const rel of dstFiles.keys()) if (!srcFiles.has(rel)) diffs.push(`- ${rel}`);

if (check) {
  if (diffs.length) {
    console.error(`.claude/skills desatualizado (${diffs.length}):\n${diffs.join("\n")}\nRode: node scripts/sync-skills.mjs`);
    process.exit(1);
  }
  console.log("skills sincronizadas");
  process.exit(0);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`${srcFiles.size} arquivo(s) sincronizado(s) em .claude/skills${diffs.length ? ` (${diffs.length} alteração(ões))` : ""}`);
