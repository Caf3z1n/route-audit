# Resultados da avaliação local

Testes de 25 de novembro de 2026. O pacote foi empacotado com `npm pack` e instalado pelo tarball em outro projeto, com o executável e o import da integração verificados.

| Caso | Rotas verificadas | OK | Divergências |
|---|---:|---:|---:|
| OpenDialog — arquivos do build estático | 204 | 204 | 0 |
| OpenDialog — cópia com uma página removida | 204 | 203 | 1 |
| OpenDialog — amostra no domínio público | 3 | 3 | 0 |
| Bioconductor — contrato público e controles HTTP | 13 | 5 | 8 |

## OpenDialog

Usei o código-fonte e os XMLs da [revisão 7725f67](https://github.com/opendialogai/docs/tree/7725f67634797fd147211195f65d9302a9a69cb4). O índice do sitemap aponta para outro XML que contém as 204 URLs. O auditor percorreu os dois arquivos e conferiu a saída HTML do Astro.

No controle negativo, omiti `dist/getting-started-1/getting-ready/index.html` **apenas em uma cópia local** da saída. O resultado passou de 204 aprovações para 203, com uma divergência `missing` exatamente em `/getting-started-1/getting-ready`. O comando retornou 0 no build de referência e 1 na cópia. O código 404 no relatório estático representa ausência do arquivo correspondente.

A consulta HTTP separada retornou 200 na raiz, em `/getting-started-1/getting-ready` e em `/release-notes/version-3-upgrade-guide`. A amostra cobre três URLs do domínio público.

[Build estático](reports/opendialog-build.json) · [Remoção simulada](reports/opendialog-remocao-simulada.json) · [Amostra HTTP pública](reports/opendialog-http.json)

## Bioconductor

O teste fez GET nas URLs públicas e comparou as respostas com o plano da [issue 187](https://github.com/seandavi/bioc-infrastructure/issues/187). Os oito endereços abaixo retornaram 200 já no primeiro salto.

| Caminho | Resposta prevista na issue |
|---|---|
| `/help/publications/` | 301 para `https://impact.bioconductor.org/` |
| `/help/publications/index.html` | 301 para o mesmo destino |
| `/dashboard/` | 410, com previsão de 301 quando a página de status existir |
| `/developers/gitlog/` | 410 |
| `/developers/rss-feeds/gitlog.xml` | 410 |
| `/developers/rss-feeds/gitlog.release.xml` | 410 |
| `/developers/help_wanted/` | 410 |
| `/rss/new_packages.rss` | 410 |

As cinco subpáginas de controle, tiradas das áreas de livros, capítulos, artigos, compêndios e relatórios técnicos, terminaram em 200. O capítulo MiMB passou primeiro por um 302. Os dois XMLs acima são caminhos concretos da regra genérica de feeds do Git. A [atualização da migração](https://github.com/Bioconductor/bioconductor.org/issues/440#issuecomment-6931042391) informa que a página de ajuda voltou. Isso explica por que um resultado divergente da issue pode representar uma decisão intencional do projeto. O teste registra o HTTP recebido deste ambiente no horário indicado no JSON.

[Relatório HTTP por rota](reports/bioconductor.json)

## Verificação do MVP

Os quatro testes automatizados cobrem sitemaps encadeados, prefixo de publicação, página presente ou ausente, redirecionamento por HTML e por HTTP, destino incorreto, loops, remoção intencional e erros inconclusivos. Uma aplicação de teste do Astro também concluiu o build quando a rota existia e falhou pelo hook quando a lista exigiu uma página ausente.

Para repetir os testes, abra o [README](README.md). A evidência sobre o build estático diz respeito aos arquivos gerados; códigos do provedor de hospedagem exigem uma prévia HTTP. As expectativas e os sitemaps ficam na pasta `examples`, e as observações completas, em `reports`.
