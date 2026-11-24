@AGENTS.md

## Notas específicas do Claude Code

- As skills ficam em `.claude/skills/` como cópia gerada. Edite em `.agents/skills/` e rode `node scripts/sync-skills.mjs`.
- Para a revisão cruzada com o Codex, use a skill `revisao-cruzada`. Ela chama `codex exec` em modo `read-only` e grava a revisão em `casos/<ID>/revisoes/`.
- Ao delegar implementação ao Codex: `codex exec -C . -s workspace-write -o docs/tasks/NN-resultado.md "Implemente a spec docs/tasks/NN-....md seguindo o AGENTS.md"`. Depois revise o diff e rode `uv run pytest` antes do commit.
