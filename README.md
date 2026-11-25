# Astro Route Audit

Compara URLs históricas com um build estático do Astro/Starlight ou com as respostas HTTP de uma prévia. Requer Node.js 22.12 ou superior. O pacote está marcado como privado para a avaliação local.

## Rodar a partir do código-fonte

```sh
npm ci
npm test
node bin/cli.js --help
node bin/cli.js --config examples/bioconductor.json --preview https://bioconductor.org --json bioconductor-agora.json
```

A última linha consulta apenas as rotas do exemplo. O resultado pode mudar com o tempo.

## Instalar em outro projeto

```sh
npm install -D ./caf3z1n-astro-route-audit-0.1.0.tgz
npx astro-route-audit --config route-audit.json --dist dist
```

Ajuste o caminho do tarball local. Exemplo de arquivo de configuração:

```json
{
  "site": "https://docs.example.org",
  "sitemaps": ["./referencia/sitemap.xml"],
  "routes": [
    "/guias/",
    { "path": "/antiga/", "status": 301, "location": "/nova/" },
    { "path": "/retirada/", "status": 410 }
  ]
}
```

Use apenas a origem em `site` e `--preview`. As rotas incluem o prefixo público. Um sitemap pode ser uma lista XML ou um índice de arquivos XML locais em UTF-8. Espelhe os subdiretórios do índice em disco. Para um índice publicado fora da raiz, informe `{"file":"referencia/index.xml","publicPath":"/docs/index.xml"}`. As regras explícitas substituem a expectativa padrão para a mesma rota. Forneça exemplos concretos para testar rotas com curingas.

**Build estático.** `--dist` procura o arquivo exato, a página com extensão HTML ou o index da pasta e acompanha meta refresh imediato. Use `--base /docs` para remover o prefixo público ao procurar arquivos. Uma página presente é evidência do arquivo gerado. Exija códigos HTTP ou comportamento da CDN no modo prévia.

**Prévia HTTP.** O CLI faz GET sem credenciais, verifica o primeiro status e destino e acompanha até dez redirecionamentos. Uma rota comum deve terminar em HTTP 200. Uma remoção planejada pode exigir 410. Para seguir um destino externo, indique sua origem na URL esperada em `location`. Respostas 401, 403, 429 e 5xx, além de erros de rede, são inconclusivas. Páginas de erro com HTTP 200 e âncoras ficam fora do escopo do MVP. Hosts com SSR exigem teste em prévia.

**Resultados e CI.** `--json arquivo.json` grava as expectativas, resultados e saltos por rota, com horário em UTC. Código 0 indica aprovação, 1 indica divergências e 2 indica erro operacional, configuração inválida ou evidência inconclusiva. Com `--report-only`, divergências por si só permitem saída 0.

## Integrar ao Astro

```js
import { defineConfig } from 'astro/config';
import routeAudit from '@caf3z1n/astro-route-audit';

export default defineConfig({
  integrations: [routeAudit({ config: 'route-audit.json', reportOnly: true })],
});
```

Coloque o hook após as integrações que modificam o HTML. Nesse modo, use uma lista de rotas comuns ou um sitemap. Para expectativas de status use o CLI com `--preview` após o deploy.

## Repetir com os exemplos

- **OpenDialog.** Os dois XMLs do exemplo são cópias dos [arquivos públicos no commit 7725f67](https://github.com/opendialogai/docs/tree/7725f67634797fd147211195f65d9302a9a69cb4/reference). Após compilar a mesma revisão, rode `node bin/cli.js --config examples/opendialog.json --dist /caminho/para/dist`. Os detalhes do teste controlado estão no relatório entregue com o pacote.
- **Bioconductor.** A referência vem da [issue 187](https://github.com/seandavi/bioc-infrastructure/issues/187). Os dois feeds RSS testados concretizam a regra para gitlog*.xml. As cinco subpáginas preservadas são controles. A [atualização da migração](https://github.com/Bioconductor/bioconductor.org/issues/440#issuecomment-6931042391) descreve decisões posteriores.
