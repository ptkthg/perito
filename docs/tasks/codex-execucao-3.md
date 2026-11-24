Implementadas as Partes A e B: filtro de domínio por substring, grafo puro e rota `/api/casos/{id}/grafo` com cache e `relevantes=1`.

Desvios: nenhum funcional; convenções documentadas no [resultado](05-resultado.md).

Testes: **131 passaram em 10,50 s**, com o comando solicitado. Sem commit. Alterações concorrentes em `ui/` foram preservadas.