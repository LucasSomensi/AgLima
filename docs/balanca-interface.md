# Interface da balança

Telas de `/balanca` pensadas para o operador que usa o sistema o dia inteiro:
pouco texto, ícones com dica (`title`/`aria-label`), tabelas densas e as ações
frequentes (ticket, NF, próxima pesagem) a um clique.

## Peças compartilhadas

- **Ícones:** sprite em `public/icons/wb.svg`. No HTML:
  `<svg class="wb-i"><use href="/icons/wb.svg#i-print"></use></svg>`. No renderer,
  `icon('print')`. Todo botão só com ícone leva `title` e `aria-label` com o nome
  completo da ação ("Imprimir ticket", "Adicionar tara"...).
- **Estilos:** bloco `wb-*` no fim de `public/css/styles.css` (barra superior,
  botões, tabelas, peso em destaque, campos de cópia, seções recolhíveis).
- **Script:** `public/js/weighbridge-ui.js`, incluído em todas as telas da balança
  e no `/admin`:
  - peso ao vivo da balança 1 na barra superior (`[data-live-weight]`), lido de
    `GET /balanca/balancas/1/peso-atual` a cada 3 s enquanto a aba está visível.
    Fica amarelo com leitura de mais de 1 minuto e vermelho sem leitura;
  - cópia com um clique (`[data-copy]` e `[data-clipboard-report]`), trocando o
    ícone por ✓ por um instante;
  - filtro das movimentações recentes (`[data-movement-filter]`);
  - botões que abrem seções recolhíveis (`[data-open-details]`);
  - atalhos de teclado (`[data-shortcut]`), ignorados enquanto o foco está num campo.
- **Barra superior:** `buildTopbar` no renderer. Voltar, título, chips de contexto
  (placa, produto, horário), ações da tela e o peso ao vivo.

## Página inicial

1. **Barra:** peso ao vivo, contratos, fotos automáticas e sair.
2. **Ações principais:** Entrada (`E`), Saída (`S`) e Avulsa (`A`), com atalhos de
   teclado. Ao lado, o resumo do dia (`getScaleDaySummary`): quantidade e líquido
   de entradas e saídas no dia de Brasília. Se a consulta falhar, o resumo some e
   a página continua.
3. **Pátio:** caminhões com pesagem pendente, do mais antigo para o mais novo, com
   o tempo de espera (em amarelo a partir de 2 h) e um botão por pendência (Tara,
   Bruto, Classificação, Contrato, Pesagem 2).
4. **Recentes:** as 10 últimas entradas, saídas e avulsas numa tabela só, mais
   recentes primeiro, com filtro por tipo e links para as listas completas. A
   coluna de detalhes mostra origem e classificação (entradas), contrato e
   motorista (saídas) ou vendedor/comprador/comentário (avulsas); o que falta
   aparece como botão tracejado. As ações da linha são copiar relatório (entrada
   completa), NF (saída com contrato) e imprimir ticket (quando disponível).

Datas curtas: só a hora para hoje, `dd/mm hh:mm` no ano corrente e `dd/mm/aa hh:mm`
antes disso; a data completa fica na dica.

### Próximo passo depois de pesar

Ao concluir uma pesagem, a mensagem da página inicial traz o próximo passo:

| Depois de | Redirecionamento | Botão na mensagem |
| --- | --- | --- |
| Tara da entrada | `/balanca?entrada_tara_adicionada=1&entrada_id=:id` | Imprimir ticket |
| Pesagem 2 da avulsa | `/balanca?avulsa_pesagem_2_adicionada=1&avulsa_id=:id` | Imprimir ticket |
| Bruto da saída sem contrato | `/balanca?saida_bruto_adicionado=1&saida_id=:id` | Associar contrato |

Saída com bruto e contrato continua indo direto para a tela de NF. O id só é aceito
se for numérico.

## Detalhes (entrada, saída, avulsa)

- Barra com as ações: **Ticket** (dourado quando disponível; desabilitado com o
  motivo na dica), NF ou Contrato (saída), copiar relatório (entrada), dividir
  (saída com bruto), editar e excluir.
- Pesos em destaque (bruto, tara, líquido em kg e sacas) com o horário de cada
  pesagem. Clicar no número copia o peso sem separador de milhar. Peso pendente
  vira botão para adicioná-lo.
- Origem, classificação e contrato com botão quando pendentes; na saída, o
  contrato tem o botão de desvincular e o saldo do contrato.
- Editar, dividir e excluir ficam recolhidos. Se a edição volta com erro, a seção
  já abre preenchida.

## Informações NF

Todos os campos na ordem de preenchimento da nota, em grade. O campo inteiro é o
botão de copiar. Rótulos curtos: Vendedor, IE vendedor, CPF/CNPJ comprador, IE
comprador, Comprador, CEP, Endereço, Número, Natureza da operação, Inf. adicionais,
Produto, CFOP, Líquido kg, Líquido t, Preço/kg, Preço/t, CNPJ transportadora, IE
transportadora, Transportadora, UF transportadora, Placa, Nome da NF, E-mail e Obs.
do contrato. A barra traz o ticket e o link para os detalhes da saída.

## Formulários

Rótulos curtos, foco já no primeiro campo útil (placa nos formulários novos, peso
nos de tara, bruto e pesagem 2) e o contexto do registro como chips na barra
(placa, produto, bruto/tara já registrado, horário). Os botões de peso da balança e
de foto automática continuam iguais (`public/js/weighbridge-scale-weight.js`).
