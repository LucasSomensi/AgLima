# Acesso ao banco para consultas e análises

Este guia é para agentes e pessoas que precisam responder perguntas sobre os dados da AgroLima ou gerar gráficos a partir do PostgreSQL hospedado no Railway. Para o modelo das tabelas, consulte [database.md](database.md); para os inventários atuais, consulte [columns.txt](columns.txt) e [constraints.txt](constraints.txt).

## Credenciais locais

Na raiz do projeto, o arquivo `.env` contém a URL completa da conta de leitura. Ele é ignorado pelo Git, tem acesso restrito ao proprietário nesta máquina e deve permanecer somente em máquinas autorizadas. Os valores reais não devem aparecer em commits, documentação, mensagens ou saídas de comandos.

```dotenv
AGROLIMA_READONLY_URL=postgresql://agrolima_leitura:senha-de-leitura@host-publico:porta/banco
```

- `AGROLIMA_READONLY_URL` reúne endereço, porta e banco do Railway com o usuário e a senha de `agrolima_leitura`. Use **somente esta variável** para consultas e gráficos. A URL inteira é uma credencial: não a imprima nem a coloque em argumentos de comandos.
- Esta máquina ainda possui `DATABASE_PUBLIC_URL` (URL com credencial administrativa) e `AGROLIMA_READONLY_PASSWORD` no `.env`, usados para configurar a conta de leitura. Eles não são necessários em outro computador que fará apenas análises: nesse computador, configure somente `AGROLIMA_READONLY_URL`.
- `DATABASE_URL` é a variável usada pela aplicação web (`routes/database.js`). Não altere a configuração do site para conectar o agente.
- `PGPASSWORD` não é necessária quando a URL de conexão já contém a senha.

O Node.js **não carrega `.env` automaticamente**. Nos exemplos abaixo, `--env-file=.env` faz isso para o comando local.

## Permissões da conta de análise

O usuário `agrolima_leitura` recebeu `SELECT` nas tabelas que existiam no schema `public` quando a conta foi criada, **exceto `public.users`**, que contém hashes de senhas. Ele não recebeu permissões de escrita. A configuração da conta também inicia transações em modo somente leitura e limita consultas a 30 segundos.

Novas tabelas não recebem `SELECT` automaticamente. Se uma consulta falhar por falta de permissão, verifique a tabela necessária e solicite a concessão específica; não use a credencial administrativa como alternativa para análises. Views e funções novas também devem ser examinadas para não expor dados de `public.users` indiretamente.

## Teste de conexão

Execute a partir da raiz do projeto, com as dependências instaladas (`npm install`). O exemplo usa diretamente a URL de leitura e imprime apenas o nome do usuário e o resultado dos testes de permissão:

```bash
node --env-file=.env - <<'NODE'
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.AGROLIMA_READONLY_URL });

(async () => {
  await client.connect();
  const { rows: [result] } = await client.query(`
    SELECT current_user AS usuario,
           has_table_privilege(current_user, 'public.contratos', 'SELECT') AS pode_ler_contratos,
           has_table_privilege(current_user, 'public.users', 'SELECT') AS pode_ler_usuarios,
           has_table_privilege(current_user, 'public.contratos', 'INSERT') AS pode_inserir_contratos
  `);
  console.log(result);
})().catch((error) => {
  console.error('Falha na conexão ou na consulta:', error.code || error.message);
  process.exitCode = 1;
}).finally(() => client.end());
NODE
```

O esperado é `usuario: 'agrolima_leitura'`, `pode_ler_contratos: true`, `pode_ler_usuarios: false` e `pode_inserir_contratos: false`. Não imprima a URL nem as senhas para diagnosticar erros.

## Convenções para análises

- Use consultas agregadas e limite o volume de linhas retornadas ao agente. O acesso de leitura inclui dados operacionais e pessoais de outras tabelas.
- Datas de operação devem ser agrupadas no fuso `America/Sao_Paulo`, conforme o restante da aplicação.
- Para entradas da balança, `peso_liquido_kg` representa peso bruto menos tara; `liquido_real_kg` aplica os ajustes de classificação usados no estoque. Identifique qual medida foi usada ao apresentar totais.
- O banco não possui uma coluna geral de safra nas entradas da balança. Se a pergunta mencionar uma colheita ou safra, explicite o recorte de datas adotado.
