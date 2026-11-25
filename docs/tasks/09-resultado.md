# Resultado da tarefa 09 — deploy Vercel

Concluída em 2026-11-25T00:54:27Z.

**Produção:** https://perito-demo-lovat.vercel.app

## Configuração confirmada

- Projeto `perito-demo`, Root Directory `ui`, framework Vite.
- GitHub conectado a `ptkthg/perito`, branch de produção `main`. A conexão foi realizada pela API autenticada da CLI; não há passo manual pendente para habilitar os próximos deploys por push.
- Último deploy em `READY`, destino `production`.
- Proteção `prod_deployment_urls_and_all_previews`: domínio de produção público; previews e URLs individuais de deploy continuam protegidos.
- `ui/vercel.json` preservado, incluindo build, diretório de saída e os seis cabeçalhos.

Referência: consulta autenticada `GET /v9/projects/perito-demo` após o deploy; acesso público confirmado pelos comandos abaixo em 2026-11-25T00:54:27Z.

## Comandos executados

Os comandos Vercel utilizaram exclusivamente a sessão já autenticada, sem argumento de token. Respostas da API foram processadas em memória e tiveram somente campos selecionados exibidos.

```powershell
git status --short
npx vercel whoami
$env:npm_config_cache = Join-Path $env:TEMP 'perito-npm-cache'
npx --yes --package vercel vercel whoami

# Executado em ui/
npm run build:demo

# Executados na raiz; ajuda consultada para project, api, link,
# project create, project update e deploy.
npx --yes --package vercel vercel api /v9/projects/perito-demo

'{"name":"perito-demo","framework":"vite","rootDirectory":"ui","gitRepository":{"type":"github","repo":"ptkthg/perito"}}' |
  npx --yes --package vercel vercel api /v10/projects -X POST --input -

'{"ssoProtection":{"deploymentType":"prod_deployment_urls_and_all_previews"}}' |
  npx --yes --package vercel vercel api /v9/projects/perito-demo -X PATCH --input -

npx --yes --package vercel vercel deploy --project perito-demo --dry --json
npx --yes --package vercel vercel deploy --project perito-demo --prod --yes
npx --yes --package vercel vercel api /v9/projects/perito-demo
git check-ignore .vercel/probe ui/.vercel/probe
git diff --check
```

A chamada inicial `npx vercel whoami` não encontrou o executável. A alternativa com `--package vercel` funcionou e confirmou a conta prevista na tarefa.

O primeiro deploy falhou porque o filtro inicial de upload excluiu `ui`. O filtro foi corrigido antes da publicação bem-sucedida. O dry-run final confirmou 120 arquivos, incluindo `ui/src/main.tsx` e `ui/vercel.json`, sem casos ou configuração privada.

Foram acrescentados `.vercel/` ao `.gitignore` e um `.vercelignore` para excluir casos, configuração local, dependências e outros arquivos alheios ao build. A opção `--project perito-demo` evitou criar vínculos locais: não foram criadas pastas `.vercel/` na raiz ou em `ui`.

Uma linha de inspeção da primeira tentativa escapou do filtro de saída com um identificador de deploy. Ela não é reproduzida neste arquivo. O filtro foi corrigido para as chamadas seguintes; nenhum token foi exibido.

## Conferência pública com curl

O curl nativo do Windows e o distribuído com o Git falharam no Schannel (`SEC_E_NO_CREDENTIALS`). Foi baixado o curl oficial de `https://curl.se/windows/latest.cgi?p=win64-mingw.zip`, usando Node, e extraído para uma pasta temporária. Versão utilizada: curl 8.23.0, LibreSSL 4.4.1.

A cadeia pública de certificados confiáveis do Node e do sistema foi exportada para um PEM temporário, pois o bundle do curl não reconheceu o emissor presente no ambiente. A verificação TLS permaneceu habilitada; não foi usado `-k`.

```powershell
# $taskCurlExe: executável oficial extraído no diretório temporário.
# $taskCa: PEM temporário gerado com tls.getCACertificates de Node,
# reunindo os conjuntos default, system e extra.
foreach ($taskRoute in @('/', '/fixtures/TESTE-001/casos.json', '/demo/visao-geral.png')) {
  & $taskCurlExe --cacert $taskCa -sS --max-time 30 -D - -o NUL `
    -w 'HTTP_CODE=%{http_code}\n' ('https://perito-demo-lovat.vercel.app' + $taskRoute)
}
```

Saída relevante em 2026-11-25T00:54:27Z, sem cookies, autenticação ou bypass:

```text
GET /
HTTP/2 200
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
cross-origin-opener-policy: same-origin
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
HTTP_CODE=200

GET /fixtures/TESTE-001/casos.json
HTTP/2 200
HTTP_CODE=200

GET /demo/visao-geral.png
HTTP/2 200
HTTP_CODE=200
```

Os seis cabeçalhos também estavam presentes nas respostas do JSON e da imagem, com os mesmos valores. Uma conferência independente via `fetch` do Node, com redirecionamentos desabilitados, retornou os mesmos três códigos 200.

## Validação e estado local

- `npm run build:demo`: passou; TypeScript e build Vite concluídos, com saída em `ui/dist-demo`.
- `uv run pytest`: **178 passed in 52.74s**.
- `git diff --check`: passou.
- `git check-ignore`: confirmou que `.vercel/` na raiz e em `ui` está ignorada.

Como `uv` não estava no PATH, foi baixada a distribuição oficial de `https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip` usando Node e extraída em pasta temporária. Na raiz do repositório, foi executado `& $taskUvExe run pytest`, com `UV_CACHE_DIR` temporário. A tentativa inicial de download pelo curl nativo falhou pelo mesmo problema Schannel.

Não foi feito commit nem push. Os arquivos preexistentes `09-deploy-vercel.md` e `09-resultado-codex.md` foram preservados. A revisão por Claude prevista no AGENTS.md continua sendo uma etapa de revisão antes de eventual commit.

Em caso de regressão posterior, usar o rollback de produção da Vercel para um deployment anterior validado; nenhuma reversão foi necessária nesta execução.
