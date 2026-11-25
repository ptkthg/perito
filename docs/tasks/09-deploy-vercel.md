# Tarefa 09: publicar a demonstração na Vercel

**Executor:** Codex. **Revisor:** Claude.

## Objetivo
Criar o projeto **`perito-demo`** na Vercel da conta já autenticada na CLI (`npx vercel whoami` → `ptkthg`) e
publicar a demonstração estática (`npm run build:demo` → `ui/dist-demo`) em produção.

## Requisitos
1. **Projeto:** nome `perito-demo`, **Root Directory `ui`**. O `ui/vercel.json` já define `buildCommand`,
   `outputDirectory` e os cabeçalhos de segurança: não altere esse arquivo sem registrar o motivo.
2. **Git:** conectar o projeto ao repositório GitHub `ptkthg/perito`, branch de produção `main`, para que cada push
   publique de novo. Se a conexão pela CLI não for possível, registre o motivo e o passo manual exato.
3. **Produção pública:** a URL de produção precisa abrir sem login. Se a proteção de deploy bloquear a produção,
   ajuste só o necessário para a produção ficar pública. Previews podem continuar protegidos.
4. **Deploy de produção** e conferência na URL final, com `curl`:
   - `/` responde 200;
   - os 6 cabeçalhos do `ui/vercel.json` estão presentes;
   - `/fixtures/TESTE-001/casos.json` e `/demo/visao-geral.png` respondem 200.
5. **Segurança:**
   - nunca imprima, grave ou faça commit de token, `orgId` ou `projectId`;
   - a pasta `.vercel/` não pode ser versionada (acrescente ao `.gitignore` se faltar);
   - não use `--token` em linha de comando: use a sessão já autenticada.

## Resultado
`docs/tasks/09-resultado.md` com:
- os comandos executados (sem segredos);
- a **URL de produção**;
- a saída das conferências do item 4;
- o estado da conexão com o Git e eventuais passos manuais.
Não faça commit nem push.
