# API operacional da balança — v1

Esta API permite executar as ações do operador sem depender das páginas HTML,
cookies ou automação de navegador. A interface web continua funcionando. Os dois
caminhos usam os mesmos serviços de negócio, cálculos do banco e registros de
auditoria existentes.

Contrato importável: [api-balanca.openapi.json](api-balanca.openapi.json), no
formato [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html).
Todos os exemplos abaixo usam valores fictícios; nunca coloque credenciais reais
nesses documentos ou no Git.

## 1. Publicação e compatibilidade

1. Aplique `migrations/20261014_add_weighbridge_api_sessions.sql` com uma conexão
   administrativa, antes de publicar o código. Ela cria `balanca_api_sessoes`,
   índices e um trigger de revogação em `users`; não cria contas nem altera senhas.
2. Configure `DATABASE_URL` no serviço web, como já ocorre no site. Não há uma nova
   chave global para as operações: cada operador usa seu próprio login.
3. Use HTTPS. Teste primeiro com banco de homologação e usuários de teste.
4. Faça login, consulte uma lista e execute um ciclo de entrada e saída em
   homologação antes de apontar um cliente para produção.

Nenhuma migração é executada automaticamente na inicialização. Sem a tabela nova,
o login da API retorna `503`. Em novos ambientes, aplique a migração antes da publicação.
No banco do Railway deste projeto, ela foi aplicada em 14/10/2026: tabela, índices,
constraints e trigger de revogação habilitado foram verificados. O teste completo
de um cliente contra a API publicada ainda deve ser realizado após o deploy.

O endpoint legado `POST /api/balancas/1/peso` não mudou de endereço, corpo ou chave.
Continua aceitando apenas `Authorization: Bearer <api_key>` do equipamento. Essa
chave não dá acesso à API operacional e um token de operador não substitui essa
chave. Veja [o guia do equipamento](api-balanca.md).

## 2. Autenticação e segurança

Base: `https://SEU_DOMINIO/api/v1/balanca`.

### Login: `POST /sessao`

```http
Content-Type: application/json

{"login":"operador","password":"SENHA_DO_OPERADOR"}
```

Resposta `200`:

```json
{
  "access_token": "TOKEN_OPACO_RETORNADO_PELO_SERVIDOR",
  "token_type": "Bearer",
  "expires_in": 57600,
  "expires_at": "2026-10-14T22:00:00.000Z",
  "user": {"id":"UUID_DO_USUARIO","login":"operador","role":"weighbridge_operator"}
}
```

O token real tem 64 caracteres hexadecimais aleatórios. Dura 16 horas, não tem
renovação automática e não depende de `SESSION_DURATION_HOURS` da sessão web.
Armazene-o somente em memória ou em armazenamento protegido. Não registre senha,
token, cabeçalho Authorization nem corpos de login em logs. O banco guarda apenas
SHA-256 do token, nunca o token utilizável. O servidor responde `Cache-Control:
no-store` nas rotas v1.

Envie nas chamadas seguintes:

```http
Authorization: Bearer TOKEN_OPACO_RETORNADO_PELO_SERVIDOR
Accept: application/json
```

- Perfis aceitos: `weighbridge_operator` e `admin`. Mesmo para `admin`, esta API
  oferece o escopo operacional, não pagamentos, gestão de usuários ou edição de
  contratos. `root`, `client` e `silo_operator` não são aceitos.
- `GET /sessao` retorna `{"user":{"userId":"UUID","login":"operador","role":"weighbridge_operator"}}`.
- `DELETE /sessao` revoga o token atual, retorna `204` sem corpo. Uma nova chamada
  com esse token retorna `401`; outras sessões do operador permanecem ativas.
- Exclusão/desativação do usuário e mudança de perfil ou senha invalidam sessões
  conforme o trigger da migração. O perfil e a desativação também são conferidos
  em cada requisição. Uma requisição já em andamento pode terminar antes da revogação.
- Login incorreto, usuário inexistente ou desativado: `401` genérico. Credenciais
  válidas de perfil sem acesso: `403`. As tentativas são registradas em
  `auth_login_events`, com prefixo `API balança:` no user-agent, sem segredos.
- Login: até 10 requisições por IP a cada 15 minutos, por instância do processo,
  incluindo tentativas bem-sucedidas. Após o limite: `429` com `Retry-After`.
  O app não confia indiscriminadamente em `X-Forwarded-For`; atrás de um proxy,
  vários usuários podem compartilhar o limite. Antes de escalar, configure um
  limite distribuído e uma política de proxy confiável adequada à infraestrutura.
- Cookies e CSRF não autenticam a API. Um cookie recebido é ignorado nesse caminho;
  os formulários do site continuam exigindo CSRF. Não há CORS liberado globalmente.

Manutenção administrativa: sessões expiradas do usuário são limpas no novo login.
Também é possível executar periodicamente `DELETE FROM public.balanca_api_sessoes
WHERE expira_em <= now();`. Para revogar todas as sessões de um usuário, apague as
linhas pelo seu `usuario_id`, usando uma consulta parametrizada em ferramenta
administrativa. A API não permite listar tokens ou consultar senhas.

## 3. Convenções do contrato

- POST e PUT requerem `Content-Type: application/json`, objeto JSON e até 100 KB.
  Campos desconhecidos são rejeitados. Não envie IDs de usuário/operador: o autor
  é sempre derivado do token, inclusive na auditoria.
- IDs de entidades são inteiros positivos até o limite de bigint. Prefira texto
  (`"123"`) para evitar perda de precisão. Números JSON só são aceitos até o limite
  seguro de JavaScript. IDs de usuários são UUIDs retornados pelo servidor.
- Produto: `milho` ou `soja`, obrigatório mesmo que a tela sugira um padrão.
- Placa: `ABC1234` ou `ABC1D23`; os serviços normalizam letras para maiúsculas e
  removem separadores no corpo. Na consulta de tara anterior, envie sem separadores.
- Pesos: kg, decimal positivo, até 3 casas, no máximo `999999999.999`. Pode ser
  número ou texto com ponto, sem separador de milhares: `28740` ou `"28740.500"`.
  Peso bruto de entrada deve ser **menor que 80000**. Tara/bruto de movimentações
  não aceitam zero; o peso atual do equipamento pode ser zero.
- Percentuais: de 0 a 100, inclusive. Zero numérico é aceito. O banco pode aplicar
  a escala decimal definida em suas colunas; consulte o registro após salvar.
- Datas de envio: `YYYY-MM-DDTHH:mm` ou `YYYY-MM-DDTHH:mm:ss`, horário de Brasília,
  **sem** `Z`/offset. Na criação e na inclusão de bruto, omitir a data usa a hora do
  servidor; em PUT a data é obrigatória. Datas inválidas são rejeitadas. Datas de
  resposta timestamptz usam ISO 8601 UTC; `data_contrato` é `YYYY-MM-DD`.
- Valores `numeric`/`bigint` do PostgreSQL normalmente chegam como strings; clientes
  devem aceitar isso e usar aritmética decimal, não interpretar valores como BRL
  formatado. `null` significa pendente/ausente, não zero.
- PUT é substituição dos **campos editáveis**, não atualização parcial. Campos
  opcionais devem estar presentes com `null` para limpar; omitir gera `400`.
  Campos calculados, de auditoria e de contrato não são editáveis por PUT.
- Não há PATCH nem controle de versão otimista. Duas edições completas podem se
  sobrepor: releia o registro antes de editar. Regras condicionais como adicionar
  tara uma única vez são verificadas também no banco.

## 4. Mapa de endpoints

Todos os caminhos abaixo são relativos a `/api/v1/balanca`, exceto o endpoint
legado do equipamento. Todos exigem token, exceto `POST /sessao`.

| Método e caminho | Ação | Sucesso |
| --- | --- | --- |
| `GET /` | Últimas 10 entradas e saídas, como a página inicial | `200 {entradas, saidas}` |
| `GET /peso-atual` | Último peso recebido da balança 1 | `200 {balanca_id,peso_kg,atualizado_em}`; `404` sem leitura |
| `GET /entradas` | Histórico paginado | `200` página |
| `GET /entradas/placas?q=ABC` | Até 5 sugestões recentes de placas | `200 {items}` |
| `GET /entradas/tara-anterior?placa=ABC1D23` | Última tara da placa | `200 {id,peso_tara_kg}`; `404` se inexistente |
| `POST /entradas` | Registrar entrada com bruto | `201 {id}` e Location |
| `GET /entradas/{id}` | Detalhes da entrada | `200` registro |
| `PUT /entradas/{id}` | Editar campos operacionais | `200 {id}` |
| `POST /entradas/{id}/tara` | Adicionar tara uma única vez | `200 {id}` |
| `POST /entradas/{id}/classificacao` | Gravar/substituir classificação | `200 {id}` |
| `POST /entradas/{id}/origem` | Definir origem ainda ausente | `200 {id}` |
| `POST /entradas/{id}/deletar` | Excluir com motivo | `204` |
| `GET /entradas/{id}/relatorio` | Texto igual ao botão de copiar da placa | `200 {texto}` |
| `GET /entradas/{id}/ticket.pdf` | Ticket de pesagem | `200 application/pdf` |
| `GET /entradas.csv` | Exportar todas as entradas | `200 text/csv` |
| `GET /saidas` | Histórico paginado | `200` página |
| `POST /saidas` | Registrar saída inicialmente com tara | `201 {id}` e Location |
| `GET /saidas/{id}` | Pesagem e dados do contrato/NF, quando associado | `200` registro |
| `PUT /saidas/{id}` | Editar campos operacionais | `200 {id}` |
| `POST /saidas/{id}/bruto` | Adicionar bruto uma única vez | `200 {id,contrato_id}` |
| `GET /saidas/{id}/compradores` | Compradores com contratos elegíveis | `200 {items}` |
| `GET /saidas/{id}/contratos?comprador_id=4` | Contratos elegíveis do comprador | `200 {items}` |
| `POST /saidas/{id}/associar` | Vincular contrato | `200 {id,contrato_id}` |
| `POST /saidas/{id}/desvincular-contrato` | Remover vínculo | `200 {id,contrato_id:null}` |
| `POST /saidas/{id}/dividir` | Dividir o peso líquido em duas saídas | `201 {saida_original_id,nova_saida_id}` e Location |
| `POST /saidas/{id}/deletar` | Excluir com motivo | `204` |
| `GET /saidas/{id}/nf` | Dados para preenchimento da NF | `200` dados; `409` sem contrato |
| `GET /saidas/{id}/ticket.pdf` | Ticket após bruto e contrato | `200 application/pdf` |
| `GET /saidas.csv` | Exportar todas as saídas | `200 text/csv` |
| `GET /contratos` | Não embarcados com saldo positivo, paginado | `200` página |
| `GET /contratos/{id}` | Contrato e saídas vinculadas | `200 {contract,outputs}` |

Navegação, preenchimento de formulário, impressão e área de transferência são
ações locais do cliente: use as consultas, o PDF, o relatório e os dados de NF.
`GET /saidas/{id}/nf` **não emite uma nota fiscal na SEFAZ**. Não foram adicionadas
ações administrativas que o operador não possui no site.

### Paginação

`GET /entradas`, `/saidas` e `/contratos` aceitam `pagina` (padrão 1, máximo
1000000) e `limite` (padrão 50, máximo 100). Exemplo:

```json
{"items":[{"id":"123"}],"pagina":1,"limite":50,"tem_proxima":false}
```

Entradas/saídas: data e ID decrescentes. Contratos: data e ID crescentes.
Não há contagem total na resposta. Passe para a próxima página enquanto
`tem_proxima` for true. A paginação não representa um snapshot: novas operações
podem deslocar itens. Exportações CSV trazem todos os registros em ordem crescente,
separador `;`, UTF-8 com BOM, datas de Brasília e decimais pt-BR. CSVs completos
usam memória proporcional ao histórico, assim como a exportação web atual.

`GET /contratos` só aceita ausência de `filtro` ou `filtro=nao-embarcados`.
Sugestões e listas de compradores/contratos elegíveis retornam `{items:[...]}`
sem paginação. `q` nas sugestões é opcional e limitado a 20 caracteres.

## 5. Fluxo completo de entrada

### Criar

`POST /entradas`:

```json
{"data_entrada":"2026-10-14T09:30","placa_caminhao":"ABC1D23","produto":"milho","peso_bruto_kg":"32000","usar_tara_anterior":false}
```

Obrigatórios: `placa_caminhao`, `produto`, `peso_bruto_kg`. `data_entrada` é opcional;
`usar_tara_anterior` é booleano opcional, padrão false. Se true, usa a tara mais
recente da mesma placa, preservando a referência da entrada de origem. Sem tara
anterior ou se ela não for menor que o bruto, retorna `409` sem criar a entrada.
Resposta: `201 {"id":"123"}`. Guarde esse ID.

### Completar

```text
POST /entradas/123/tara            {"peso_tara_kg":"12000"}
POST /entradas/123/origem          {"origem":"Fazenda X — Talhão 4"}
POST /entradas/123/classificacao   {"umidade_percent":14,"impureza_percent":1,"graos_avariados_percent":0}
```

Tara deve ser menor que bruto e ainda não estar preenchida (`409` caso contrário).
Origem: texto não vazio, até 200 caracteres, gravável por essa ação apenas quando
ainda não definida. Classificação exige os três percentuais; pode substituir uma
classificação existente, como no site. Os cálculos de líquido e líquido real são
feitos pelo banco, não enviados pelo cliente.

Consulte `GET /entradas/123` após gravar. O PDF exige tara e líquido; o relatório
para copiar exige tara, origem e os três percentuais. Antes disso, retornam `409`.
`GET /entradas/123/relatorio` devolve `texto` com linhas de data/hora, placa, origem,
líquido arredondado em kg e umidade com uma casa, idêntico ao site.

### Editar

`PUT /entradas/123` exige estes nove campos:

```json
{
  "data_entrada":"2026-10-14T09:30",
  "placa_caminhao":"ABC1D23",
  "produto":"milho",
  "peso_bruto_kg":"32000",
  "peso_tara_kg":"12000",
  "origem":"Fazenda X — Talhão 4",
  "umidade_percent":14,
  "impureza_percent":1,
  "graos_avariados_percent":0
}
```

Tara, origem e classificação podem ser limpas com `null`. Para limpar classificação,
envie os **três** percentuais como null; para preencher, envie os três valores.
Não envie `usar_tara_anterior` na edição: a associação de tara anterior é controlada
pelo serviço, preservada se o valor não mudar e removida quando muda.

### Excluir

`POST /entradas/123/deletar`:

```json
{"motivo_delecao":"Entrada registrada em duplicidade pelo operador."}
```

Motivo obrigatório, mínimo 20 caracteres após normalização dos espaços e máximo
2000 no corpo. A exclusão é real e auditada. Se outra entrada referencia sua tara,
a integridade referencial impede a exclusão (`409`). Registro inexistente: `404`.

## 6. Fluxo completo de saída

### Criar e pesar

`POST /saidas`:

```json
{"data_saida":"2026-10-14T10:00","placa_caminhao":"ABC1D23","produto":"soja","peso_tara_kg":"12000"}
```

Data opcional; demais campos obrigatórios. Recebe `201 {"id":"456"}`.
Depois, `POST /saidas/456/bruto`:

```json
{"peso_bruto_kg":"42000","peso_bruto_adicionado_em":"2026-10-14T11:00"}
```

Data opcional. Bruto deve ser maior que tara, e ainda não preenchido. O líquido é
calculado pelo banco. Se já houver bruto ou se for insuficiente, retorna `409`.

### Associar contrato

1. `GET /saidas/456/compradores`.
2. `GET /saidas/456/contratos?comprador_id=4`.
3. `POST /saidas/456/associar` com `{"comprador_id":"4","contrato_id":"7"}`.

Contrato deve pertencer ao comprador, ser do mesmo produto e não estar marcado
como embarcado nem estar sem saldo. A saída não pode já estar vinculada. O serviço
verifica essas regras em transação com bloqueio, mesmo que a lista anterior esteja
desatualizada. Assim como na web, o peso da saída pode exceder o saldo disponível;
o operador pode usar a divisão. Associar não marca o contrato como embarcado
automaticamente; essa finalização continua manual e administrativa.

### Editar, desvincular, dividir e excluir

- `PUT /saidas/456`: exige `data_saida`, `placa_caminhao`, `produto`, `peso_tara_kg`
  e `peso_bruto_kg`; este último pode ser null. Não aceita `contrato_id` nem campos
  calculados. Mantém as mesmas regras da edição web.
- `POST /saidas/456/desvincular-contrato`, corpo `{}`: exige vínculo existente e
  preserva os dados da pesagem; retorna contrato_id null e grava auditoria.
- `POST /saidas/456/dividir`, corpo `{"peso_liquido_primeira_kg":"20000"}`: exige
  líquido calculado e valor positivo menor que o líquido original. A saída original
  fica com o primeiro peso e mantém o contrato. A nova saída recebe o restante,
  sem contrato. A operação retorna ambos os IDs e gera auditoria agrupada. Exemplo:
  líquido original 30000 vira 20000 + 10000. A tara da segunda linha é o bruto
  recalculado da primeira, conforme a regra existente do sistema.
- `POST /saidas/456/deletar`: mesmo corpo/regras de motivo da exclusão de entrada;
  apaga a saída e registra o snapshot para auditoria.

### Dados da NF e ticket

`GET /saidas/456/nf` retorna os campos da saída/contrato e cadastro fiscal do
comprador, vendedor e transportadora. Inclui `preco_por_saca`, `preco_por_kg`,
`preco_por_ton`, `peso_liquido_kg`, `peso_liquido_ton`, `nome_nf`, `cfop`,
`natureza_operacao`, inscrições estaduais, CPF/CNPJ, endereço, CEP, e-mail e
observações. Valores ausentes podem ser null. Os padrões são `natureza_operacao`
igual a `Venda` e `cfop` igual a `5101`, como na tela. `nome_nf` usa
`YYYY-MM-DD PLACA PRODUTO ID`. Não são incluídos recebimentos financeiros privados.

`GET /saidas/456/ticket.pdf` exige bruto, líquido e contrato associado. O cliente
deve salvar/imprimir o PDF; a API não controla a impressora local.

## 7. Respostas, erros e repetição segura

Sucessos: `200` JSON/arquivo, `201` criação/divisão com `Location`, `204` exclusão
ou logout sem corpo. Não tente interpretar JSON após `204` ou em PDF/CSV.
Mutações retornam IDs; faça GET para obter valores calculados e estado atualizado.
`GET /entradas/{id}` usa `id`; `GET /saidas/{id}` e `/nf` usam `saida_id`.

Erros da API v1 têm `{"code":"CODIGO_ESTAVEL","error":"Mensagem em português."}`:

| HTTP | code | Tratamento |
| --- | --- | --- |
| 400 | `INVALID_JSON`, `INVALID_BODY`, `INVALID_ID`, `INVALID_QUERY` | Corrigir requisição |
| 401 | `INVALID_CREDENTIALS`, `INVALID_TOKEN` | Corrigir login ou obter novo token |
| 403 | `FORBIDDEN` | Perfil não autorizado |
| 404 | `NOT_FOUND` | Endpoint, registro ou leitura inexistente |
| 409 | `STATE_CONFLICT`, `NO_PREVIOUS_TARE`, `INVALID_PREVIOUS_TARE`, `DATA_CONFLICT` | Reconsultar estado; conflito de regra, vínculo ou concorrência |
| 413 | `PAYLOAD_TOO_LARGE` | Reduzir corpo (máximo 100 KB) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Usar JSON/codificação suportada |
| 429 | `RATE_LIMITED` | Respeitar Retry-After no login |
| 500 | `INTERNAL_ERROR` | Falha inesperada; investigar sem divulgar segredos |
| 503 | `UNAVAILABLE` | Banco/configuração/migração indisponível |

O servidor não devolve SQL, stack trace, tokens ou detalhes internos nas falhas.
Proxy/Railway ainda pode responder `502/504` ou texto; verifique status e tipo de
conteúdo antes de tentar ler JSON.

**Não existe Idempotency-Key nesta versão. Não repita POST automaticamente após
timeout/erro de rede.** A transação pode ter sido confirmada e apenas a resposta
perdida: repetir criação ou divisão pode duplicar registros. Reconsulte o histórico
e peça confirmação ao operador antes de reenviar. GET pode ser repetido com atraso
progressivo. Edições/exclusões também exigem reconciliação do estado; repetir uma
gravação pode produzir outro evento de auditoria. Em `401` recebido pela API, a
autenticação é anterior à mutação: obtenha novo token e então tente a ação.

## 8. Exemplo de cliente Python

O exemplo não implementa leitor serial, interface nem repetição automática.
`AGROLIMA_BASE_URL` é a raiz HTTPS do site; `AGROLIMA_LOGIN` e `AGROLIMA_PASSWORD`
são variáveis **do cliente**, não novas variáveis obrigatórias do servidor.

```python
import os
import requests

base = os.environ["AGROLIMA_BASE_URL"].rstrip("/") + "/api/v1/balanca"
client = requests.Session()
client.headers["Accept"] = "application/json"

response = client.post(base + "/sessao", json={
    "login": os.environ["AGROLIMA_LOGIN"],
    "password": os.environ["AGROLIMA_PASSWORD"],
}, timeout=(5, 20))
response.raise_for_status()
client.headers["Authorization"] = "Bearer " + response.json()["access_token"]

try:
    # Consulta segura: não gera movimentação.
    response = client.get(base + "/entradas", params={"pagina": 1, "limite": 50}, timeout=(5, 20))
    response.raise_for_status()
    entradas = response.json()["items"]
    # Para gravar, use client.post(..., json=...), após confirmação do operador.
    # Em timeout de escrita, reconcilie o estado; não repita automaticamente.
finally:
    response = client.delete(base + "/sessao", timeout=(5, 20))
    response.raise_for_status()
    client.close()
```

## 9. Testes e manutenção

Execute `npm test`. `test/weighbridge-api.test.js` cobre autenticação, armazenamento
do digest, isolamento da chave do equipamento, autorização, campos/IDs inválidos,
paginação SQL, mapeamento dos endpoints, atores de auditoria, erros, PDF, CSV e NF.
Os testes HTTP usam banco simulado e não escrevem no Railway. A migração e um ciclo
com banco real devem ser validados em homologação antes da publicação.

As gravações de criação/tara/origem/classificação/associação mantêm os campos de
autoria do modelo. Edição, exclusão, bruto, desvinculação e divisão usam a auditoria
transacional existente. Isso não cria retrospectivamente logs de ações que o site
antes não auditava. Consulte [auditoria.md](auditoria.md).

Ao adicionar uma ação ao site, mantenha a API, OpenAPI, documentação e testes em
sincronia. Não envie `.env`, cookies, senhas ou tokens em exemplos ou fixtures.
