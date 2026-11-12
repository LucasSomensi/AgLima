# API de integração da balança

Este documento descreve a **API do equipamento**, para o programa Python que lê a porta serial e publica o peso da **balança 1**. Esse endpoint continua compatível com a integração existente.

Para enviar **fotos da câmera** junto com o peso e as fotos automáticas de cada pesagem, veja a seção [Fotos da câmera](#fotos-da-câmera) e o guia de implementação [autoweight-fotos.md](autoweight-fotos.md).

Para executar todas as ações do operador (entradas, saídas, classificação, contratos, relatórios e exclusões), consulte a [API operacional v1](api-balanca-operacional.md) e a [especificação OpenAPI](api-balanca.openapi.json). A chave `api_key` **não** autoriza essas operações: use o login e o token de operador descritos no novo guia.

## Visão geral do fluxo

1. O programa Python lê e processa localmente os dados recebidos pela porta serial.
2. O programa decide quando existe uma leitura relevante e estável. Essa lógica não pertence ao servidor.
3. Para cada nova leitura relevante, ele envia o peso inteiro em quilogramas para o endpoint autenticado descrito abaixo.
4. O servidor substitui o último peso da balança 1 e registra o horário de recebimento.
5. Quando o operador aperta o botão ao lado de Peso bruto ou Peso tara, o navegador consulta o último valor salvo e preenche o campo. A consulta não remove o valor do banco.

Não é necessário enviar atualizações em intervalo fixo, heartbeats, informação de estabilidade, unidade, peso anterior ou data/hora do computador local. O cliente Python é responsável por não publicar pesos instáveis, negativos ou repetidos.

## Configuração e autenticação

O servidor lê a chave da variável de ambiente chamada exatamente `api_key` (minúscula). A mesma chave deve ser configurada de forma segura no computador que executa o programa Python.

Cada requisição de publicação deve enviar o cabeçalho HTTP:

```http
Authorization: Bearer VALOR_DA_API_KEY
```

Regras importantes:

- há exatamente um espaço entre `Bearer` e a chave;
- `Bearer` diferencia maiúsculas de minúsculas e deve ser escrito dessa forma;
- a chave não deve ser enviada na URL, em query string nem no corpo JSON;
- não registre a chave em logs;
- use somente a URL HTTPS fornecida pelo Railway;
- o endpoint não usa login, cookie de sessão ou token CSRF;
- uma chave ausente ou incorreta recebe `401 Unauthorized`;
- se `api_key` não estiver configurada no servidor, a resposta será `503 Service Unavailable`.

## Publicar o peso atual da balança 1

### Requisição

```http
POST /api/balancas/1/peso HTTP/1.1
Host: SEU_DOMINIO.up.railway.app
Authorization: Bearer VALOR_DA_API_KEY
Content-Type: application/json
Accept: application/json

{"peso_kg":28740}
```

### Corpo JSON

| Campo | Tipo | Obrigatório | Regra |
| --- | --- | --- | --- |
| `peso_kg` | número JSON inteiro | Sim | Deve estar entre `0` e `2147483647`, inclusive. Não envie como texto entre aspas. |

Exemplos válidos:

```json
{"peso_kg": 0}
```

```json
{"peso_kg": 28740}
```

Exemplos inválidos:

```json
{"peso_kg": -1}
```

```json
{"peso_kg": 28740.5}
```

```json
{"peso_kg": "28740"}
```

Campos extras atualmente são ignorados, mas o programa Python não deve depender desse comportamento.

### Resposta de sucesso

O servidor responde `200 OK` tanto na primeira inserção quanto na substituição de uma leitura anterior:

```json
{
  "balanca_id": 1,
  "peso_kg": 28740,
  "atualizado_em": "2026-09-08T14:32:10.123Z"
}
```

`atualizado_em` é definido pelo servidor no momento em que a gravação ocorre. O formato é ISO 8601. O programa Python não precisa armazenar nem reenviar esse valor.

Enviar outro peso para o mesmo endpoint substitui imediatamente o anterior. Não há fila, confirmação do operador, histórico de leituras nem operação de soma. Repetir uma requisição válida é seguro quanto à estrutura do banco, mas atualizará novamente `atualizado_em`.

## Respostas de erro

Todas as respostas conhecidas da API são JSON e possuem a propriedade `error`.

| HTTP | Situação | Exemplo de resposta |
| --- | --- | --- |
| `400 Bad Request` | `peso_kg` ausente, texto, fracionário, negativo ou acima do limite | `{"error":"peso_kg deve ser um número inteiro entre 0 e 2147483647."}` |
| `401 Unauthorized` | Cabeçalho ausente, esquema diferente de Bearer ou chave incorreta | `{"error":"Chave de API inválida ou ausente."}` |
| `413 Payload Too Large` | Corpo excedeu o limite global de 100 KB (8 MB nos endpoints de foto) | `{"code":"PAYLOAD_TOO_LARGE","error":"A requisição excede 100 KB."}` |
| `503 Service Unavailable` | Variável `api_key` ausente no Railway | `{"error":"API da balança não configurada."}` |
| `500 Internal Server Error` | Falha inesperada ao gravar no banco | `{"error":"Não foi possível salvar o peso da balança."}` |

O cliente deve considerar qualquer código fora da faixa `200–299` como falha. Para erros transitórios (`500`, `502`, `503`, `504`, timeout ou falha de rede), recomenda-se repetir com *backoff* exponencial limitado. Para `400` e `401`, corrija os dados ou a configuração antes de tentar continuamente.

## Exemplo com cURL

```bash
curl --fail-with-body \
  --request POST \
  --url 'https://SEU_DOMINIO.up.railway.app/api/balancas/1/peso' \
  --header "Authorization: Bearer ${API_KEY}" \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{"peso_kg":28740}'
```

## Exemplo de referência em Python

Este exemplo mostra somente a chamada HTTP. A leitura serial, a identificação de estabilidade e a supressão de pesos negativos ou repetidos permanecem sob responsabilidade do programa local.

```python
import os

import requests


BASE_URL = "https://SEU_DOMINIO.up.railway.app"
API_KEY = os.environ["AGROLIMA_API_KEY"]


def publicar_peso(peso_kg: int) -> dict:
    if not isinstance(peso_kg, int) or isinstance(peso_kg, bool) or peso_kg < 0:
        raise ValueError("peso_kg deve ser um inteiro não negativo")

    response = requests.post(
        f"{BASE_URL}/api/balancas/1/peso",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Accept": "application/json",
        },
        json={"peso_kg": peso_kg},
        timeout=(5, 15),
    )
    response.raise_for_status()
    return response.json()
```

## Fotos da câmera

A mesma chave `api_key` autoriza dois endpoints binários. Ambos recebem o JPEG como corpo (`Content-Type: image/jpeg`, até 8 MB) e os metadados em cabeçalhos. O limite global de 100 KB não se aplica a eles.

### Peso com foto

```http
POST /api/balancas/1/peso-com-foto
Authorization: Bearer VALOR_DA_API_KEY
Content-Type: image/jpeg
X-Peso-Kg: 28740

<bytes do JPEG>
```

Faz o mesmo que `POST /api/balancas/1/peso` e também guarda a foto como **foto do peso atual**. A resposta é a mesma, com `"foto": true`. O servidor mantém só a foto mais recente (a anterior é apagada). Um peso enviado depois por `POST /api/balancas/1/peso`, sem foto, deixa a foto antiga inválida: o botão do formulário nunca anexa uma foto de outro peso.

### Fotos automáticas

```http
PUT /api/balancas/1/fotos/automaticas/{chave}
Authorization: Bearer VALOR_DA_API_KEY
Content-Type: image/jpeg
X-Peso-Kg: 28740
X-Capturada-Em: 2026-11-11T10:00:00.123-03:00
X-Substitui: chave-da-foto-anterior   (opcional)

<bytes do JPEG>
```

Grava a foto tirada ao final de uma pesagem. A `{chave}` (`^[A-Za-z0-9._-]{1,120}$`) torna o envio idempotente: `201` grava, e `200` indica que a chave já tinha sido recebida e nada mudou. `X-Capturada-Em` precisa de fuso horário. `X-Substitui` marca a foto anterior do mesmo caminhão como substituída por um peso maior. Fotos automáticas ficam guardadas por 365 dias (`FOTOS_RETENCAO_AUTOMATICAS_DIAS`).

### Erros específicos

| HTTP | Situação |
| --- | --- |
| `400` | `X-Peso-Kg`, `X-Capturada-Em`, `X-Substitui` ou chave inválidos, ou corpo que não é um JPEG completo |
| `413` | Foto acima de 8 MB (`{"code":"PAYLOAD_TOO_LARGE","error":"A foto excede 8 MB."}`) |
| `415` | `Content-Type` diferente de `image/jpeg` |
| `507` | Sem espaço no volume de fotos |
| `500` | Falha ao gravar o arquivo ou o banco |

O comportamento esperado do AutoWeight em cada caso está em [autoweight-fotos.md](autoweight-fotos.md).

## Endpoints usados pelo navegador

Para completude, o frontend usa os endpoints abaixo. **Nenhum deles deve ser usado pelo programa do equipamento.** Todos exigem a sessão normal de um operador de balança ou administrador.

```http
GET  /balanca/balancas/1/peso-atual
POST /balanca/balancas/1/peso-atual/captura
GET  /balanca/fotos/{id}
GET  /balanca/fotos?data=AAAA-MM-DD
```

- `GET /balanca/balancas/1/peso-atual` retorna `200` com a mesma estrutura da resposta de publicação, `404` quando nenhum peso foi recebido ou `500` em falha de banco. É usado pelo painel do secador.
- `POST /balanca/balancas/1/peso-atual/captura` (com token CSRF) é o botão "usar peso da balança" dos formulários de peso bruto e tara. Devolve o peso atual e, quando existe foto para esse peso, `foto: {captura_id, url, contingencia}`. A foto é copiada como **captura temporária** do operador, válida por 60 minutos. Ao salvar o lançamento, ela é vinculada à entrada ou saída apenas se o peso salvo for exatamente o peso lido. Um peso digitado ou alterado fica sem foto. Capturas não confirmadas (formulário cancelado ou abandonado) são apagadas pela limpeza periódica.
- `GET /balanca/fotos/{id}` devolve o JPEG com `Cache-Control: private`.
- `GET /balanca/fotos?data=` lista as fotos automáticas do dia.

As consultas usam `Cache-Control: no-store` para que cada clique leia o valor atual.

## Checklist para o cliente Python

- configurar a URL HTTPS sem uma barra duplicada antes de `/api`;
- carregar a chave de uma variável de ambiente ou arquivo protegido;
- mandar `peso_kg` como número inteiro JSON;
- nunca publicar peso negativo, fracionário, instável ou repetido;
- definir timeout de conexão e leitura HTTP;
- tratar códigos HTTP antes de interpretar a resposta como sucesso;
- usar repetição com atraso para falhas transitórias, sem fazer um loop agressivo;
- não imprimir o cabeçalho `Authorization` nos logs;
- manter logs locais do peso enviado, horário da tentativa, código HTTP e erro sem a chave;
- após uma resposta ambígua por timeout, é permitido reenviar o peso: o endpoint apenas substitui a leitura atual.
