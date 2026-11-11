# Fotos da balança: mudanças necessárias no AutoWeight

Este guia é a especificação completa, do lado do **AutoWeight** (programa em Rust que roda no computador da balança, repositório `LucasSomensi/AutoWeight`, pasta `rust/`), para enviar as fotos da câmera ao AgLima. O servidor AgLima já está pronto. Nada aqui exige mudanças no servidor.

Leia também a [API do equipamento](api-balanca.md) e a [especificação OpenAPI](api-balanca.openapi.json) (operações `publish_scale_weight_with_photo` e `upload_automatic_scale_photo`).

## Resumo

O AutoWeight passa a enviar dois tipos de foto:

1. **Foto junto com o peso.** Todo peso estável que hoje vai para `POST /api/balancas/1/peso` passa a ir para `POST /api/balancas/1/peso-com-foto`, com o frame mais recente da câmera no corpo. No AgLima, quando o operador clica no botão "usar peso da balança", essa foto é anexada ao lançamento.
2. **Fotos automáticas.** Cada JPG que o AutoWeight já salva em `AutoWeightData` ao final de uma pesagem é enviado para `PUT /api/balancas/1/fotos/automaticas/{chave}`, por uma fila persistente que sobrevive a reinícios e quedas de internet.

O envio de peso continua com o mesmo comportamento de hoje (janela de estabilidade, deduplicação, *backoff*). Só muda o endpoint e o corpo.

## O que já existe no AutoWeight (contexto)

Com base no código atual (`api.rs`, `camera.rs`, `photos.rs`, `runtime.rs`, `config.rs`):

- `camera.rs` roda o FFmpeg contra o RTSP (`-f image2pipe -vcodec mjpeg`, 5 fps) e mantém **o último frame JPEG em memória**. A câmera é considerada online quando esse frame tem no máximo 2 s.
- `runtime.rs` finaliza uma pesagem (peso estável acima de 1.000 kg por 3 s, ou 5 s no modo ausente) e salva a foto em `AutoWeightData/<AAAA-MM-DD-HH-MM-SS-micros>-<peso>kg.jpg`. A gravação é atômica (`.jpg.tmp` e depois `rename`). Um peso maior do mesmo caminhão substitui a foto e apaga o arquivo anterior. Sem frame recente, salva a imagem de contingência (JPEG com o comentário `AutoWeight:contingencia:manga`).
- `api.rs` envia `POST {AGROLIMA_BASE_URL}/api/balancas/1/peso` com `Authorization: Bearer <AGROLIMA_API_KEY>` e `{"peso_kg": <inteiro>}`. Só pesos estáveis (janela de 1 s), deduplicados, com um único espaço pendente em memória. Faz *backoff* de 1 s a 60 s em erro de rede, `500`, `502`, `503` e `504`. Qualquer outro código não 2xx bloqueia o envio até reiniciar. Grava o log em `AutoWeightData/agrolima.log`.
- O cliente HTTP é `reqwest` bloqueante, com 5 s de conexão, 15 s de leitura, 20 s no total e redirecionamentos desativados.

## Parte 1: peso com foto

### Endpoint

```http
POST /api/balancas/1/peso-com-foto HTTP/1.1
Host: SEU_DOMINIO.up.railway.app
Authorization: Bearer VALOR_DA_API_KEY
Content-Type: image/jpeg
X-Peso-Kg: 28740
Accept: application/json

<bytes do JPEG>
```

| Item | Regra |
| --- | --- |
| Corpo | Os bytes do frame JPEG exatamente como vieram do FFmpeg. Não reprocessar nem recomprimir. Precisa começar com `FF D8 FF` e terminar com `FF D9`. |
| Tamanho | No máximo 8 MB (8.388.608 bytes). |
| `Content-Type` | Exatamente `image/jpeg`. |
| `X-Peso-Kg` | Inteiro decimal sem sinal, de `0` a `2147483647`, sem espaços, ponto ou unidade. |
| Autenticação | A mesma de hoje: `Authorization: Bearer <AGROLIMA_API_KEY>`. |

Resposta `200 OK`:

```json
{"balanca_id":1,"peso_kg":28740,"atualizado_em":"2026-11-11T14:32:10.123Z","foto":true}
```

### Quando usar cada endpoint

No momento em que um peso estável entra no espaço pendente de envio (o mesmo ponto em que hoje ele é deduplicado), **copie também o frame mais recente da câmera**, se ele tiver no máximo 2 s. O pendente passa a ser `(peso, Option<frame>)`.

- **Com frame:** envie para `/peso-com-foto`.
- **Sem frame recente** (câmera fora do ar, FFmpeg reiniciando): envie para o `/peso` JSON de hoje. **Não** envie a imagem de contingência junto com o peso. O servidor invalida sozinho a foto anterior quando recebe um peso sem foto.

O frame deve ser o do instante em que o peso ficou estável, e não o do instante do envio. Se o envio for repetido por *backoff*, reenvie o mesmo frame guardado. Um peso mais novo substitui o pendente inteiro, com peso e frame, como já acontece hoje. Envie foto para todos os pesos estáveis, inclusive `0` e pesos abaixo de 1.000 kg.

### Tratamento das respostas de `/peso-com-foto`

| Resposta | O que fazer |
| --- | --- |
| `2xx` | Sucesso. Zera o *backoff*, como hoje. |
| Rede, timeout, `500`, `502`, `503`, `504` | *Backoff* exponencial de 1 s a 60 s, como hoje, reenviando o mesmo peso e o mesmo frame. |
| `507` (sem espaço no volume), `413` (foto grande demais), `415` | Envie **o mesmo peso sem foto** para `/peso` imediatamente e registre no log. O peso nunca pode ficar parado por causa da foto. |
| `400` | Reenvie o mesmo peso sem foto para `/peso`. Se o `/peso` também devolver `400`, siga a regra atual de bloqueio. |
| `404` | O servidor ainda não tem o endpoint (AgLima antigo). Envie sem foto para `/peso` e só tente `/peso-com-foto` de novo depois de 10 minutos. Isso permite atualizar o AutoWeight antes do AgLima. |
| `401` e demais | Mesma regra atual: bloqueia o envio até reiniciar e mostra `AgroLima: HTTP <código>. Corrija e reinicie.` |

### Timeouts

Mantenha 5 s de conexão. Para `/peso-com-foto`, use um tempo total de **30 s**, porque o corpo tem algumas centenas de KB a poucos MB e o upload do Starlink é menor que o download.

### Log

Acrescente a cada linha de `agrolima.log` o campo `foto=sim|nao`, por exemplo:

```
2026-11-11 11:32:10 Peso=28740 kg HTTP=200 resultado=enviado foto=sim
```

## Parte 2: fotos automáticas

### Endpoint

```http
PUT /api/balancas/1/fotos/automaticas/2026-11-11-10-00-00-123456-28740kg HTTP/1.1
Host: SEU_DOMINIO.up.railway.app
Authorization: Bearer VALOR_DA_API_KEY
Content-Type: image/jpeg
X-Peso-Kg: 28740
X-Capturada-Em: 2026-11-11T10:00:00.123456-03:00
X-Substitui: 2026-11-11-09-59-55-000001-28500kg
Accept: application/json

<bytes do arquivo .jpg>
```

| Item | Regra |
| --- | --- |
| `{chave}` | O nome do arquivo **sem** `.jpg`. Deve casar com `^[A-Za-z0-9._-]{1,120}$`, e o formato atual (`2026-11-11-10-00-00-123456-28740kg`) já casa. A chave é o identificador único da foto. |
| Corpo | Os bytes do arquivo, sem alteração. Inclui as imagens de contingência: o servidor as reconhece pelo comentário JPEG e as marca como "câmera indisponível". Máximo de 8 MB. |
| `X-Peso-Kg` | O peso do nome do arquivo (o número antes de `kg`). |
| `X-Capturada-Em` | Data e hora do nome do arquivo em ISO 8601 **com fuso** (`chrono::Local`, por exemplo `-03:00`). Sem fuso, o servidor recusa. Não pode estar mais de 5 minutos no futuro em relação ao relógio do servidor. |
| `X-Substitui` | Opcional (detalhes abaixo). |

Respostas:

- `201 Created`: foto gravada.
- `200 OK`: **essa chave já tinha sido recebida**, e nada foi alterado. Trate como sucesso. É o que torna o reenvio seguro depois de um timeout.

Corpo de `201` e de `200`:

```json
{"id":"6f5e…","chave":"2026-11-11-10-00-00-123456-28740kg","peso_kg":28740,"capturada_em":"2026-11-11T13:00:00.123Z","recebida_em":"2026-11-11T13:00:02.456Z","contingencia":false,"status":"recebida"}
```

### Fila persistente

A fila de peso é um espaço em memória, mas a de fotos **não pode** ser assim: um caminhão pode passar com a internet fora do ar.

- A fila é a própria pasta `AutoWeightData`: todo `.jpg` que casa com o padrão do histórico (o mesmo usado por `photos::list`) e ainda não foi confirmado.
- Guarde as chaves confirmadas em `AutoWeightData/fotos-enviadas.txt`, uma por linha, só acrescentando linhas e com `flush` e `sync` depois de cada uma. Carregue o arquivo num `HashSet` ao iniciar.
- Uma chave recusada de forma permanente (veja a tabela abaixo) vai para `AutoWeightData/fotos-recusadas.txt`, no mesmo formato, e não é tentada de novo.
- Rode o envio numa **thread própria**, uma foto por vez, para não atrapalhar a leitura serial nem o envio de peso. Use um cliente `reqwest` próprio com 5 s de conexão e 60 s no total.
- Varra a pasta ao iniciar, logo depois de cada foto salva (um sinal pelo canal da thread) e a cada 60 s como garantia.
- Ordem: **das mais novas para as mais antigas**, para a última pesagem aparecer logo.
- **Histórico antigo:** só envie fotos com até 365 dias. As mais antigas seriam apagadas pelo servidor de qualquer forma, porque a retenção é de 1 ano.
- Ignore arquivos `.tmp` e arquivos que sumirem entre a varredura e o envio (`NotFound`).

### Substituição por peso maior

Quando `runtime.rs` substitui a foto de um caminhão por outra mais pesada e apaga o arquivo anterior:

- se a chave anterior **já está** em `fotos-enviadas.txt`, envie a nova foto com `X-Substitui: <chave anterior>`. O servidor marca a anterior como "substituída por peso maior" e mantém as duas;
- se a anterior **ainda não foi enviada**, não faça nada: o arquivo foi apagado e sai da fila sozinho.

Basta guardar em memória o par `(chave nova, chave substituída)` até a nova ser enviada. Depois de um reinício a informação se perde e a foto vai sem `X-Substitui`, o que é aceitável.

### Tratamento das respostas

| Resposta | O que fazer |
| --- | --- |
| `200` ou `201` | Acrescente a chave em `fotos-enviadas.txt`. |
| Rede, timeout, `500`, `502`, `503`, `504`, `507` | *Backoff* exponencial de 1 s a 60 s e tente a mesma foto de novo. |
| `400`, `413`, `415` | Recusa permanente: registre no log e acrescente em `fotos-recusadas.txt`. Siga para a próxima foto. |
| `404` | AgLima ainda sem o endpoint: pause o envio por 10 minutos, sem marcar a foto. |
| `401`, `403` | Pare o envio de fotos até reiniciar, com a mesma mensagem de status usada para o peso. |

### Log

Crie `AutoWeightData/fotos.log` com o mesmo formato e a mesma rotação de `agrolima.log` (1.000.000 bytes, guardando `.1` a `.3`):

```
2026-11-11 10:00:03 Foto=2026-11-11-10-00-00-123456-28740kg HTTP=201 resultado=enviada
```

Nunca registre o cabeçalho `Authorization` nem a URL com credenciais.

## Configuração

Nenhuma variável nova é obrigatória: tudo usa `AGROLIMA_BASE_URL` e `AGROLIMA_API_KEY`. Acrescente uma opcional:

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `AUTOWEIGHT_ENVIAR_FOTOS` | `1` | `0` desliga as duas partes: o peso volta a ir só para `/peso` e a fila de fotos automáticas não roda. |

Se a integração com o AgLima estiver desligada (URL e chave vazias), nada de fotos é enviado.

## Interface

Na linha de status do AgLima, mostre também a fila de fotos, por exemplo `Fotos: 0 pendentes` ou `Fotos: 3 pendentes (sem internet)`.

## Testes esperados

- **Classificação de status:** cada código das duas tabelas leva à ação certa.
- **Extração da chave**, de `X-Peso-Kg` e de `X-Capturada-Em` a partir do nome do arquivo, com fuso.
- **Fila persistente:**
  - uma chave confirmada não é reenviada depois de reiniciar;
  - um arquivo apagado sai da fila;
  - um `.tmp` é ignorado;
  - fotos com mais de 365 dias são ignoradas.
- **Peso pendente:** um peso novo substitui peso e frame juntos; sem frame recente, o envio vai para `/peso`.
- **Recuo do `/peso-com-foto`:** com `404`, `413` ou `507`, o mesmo peso sai por `/peso` sem esperar *backoff*.
- **Teste manual:**
  - com `--demo`, o AgLima recebe peso com foto e o botão do formulário mostra a miniatura;
  - uma pesagem completa aparece em `/balanca/fotos`.

## Critérios de aceite

1. Com a câmera funcionando, todo peso estável chega ao AgLima com foto, e o botão do formulário anexa a miniatura.
2. Com a câmera desligada, o peso continua chegando, sem foto.
3. Com a internet desligada durante uma pesagem, a foto automática é enviada sozinha quando a conexão volta, mesmo se o AutoWeight tiver sido reiniciado nesse meio-tempo.
4. Reenviar a mesma foto nunca cria duplicata no AgLima.
5. Nenhuma falha relacionada a fotos impede o envio do peso.
