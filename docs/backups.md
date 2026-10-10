# Backup pelo painel administrativo

O painel `/admin` mostra uma notificação se nenhum backup foi registrado ou se o
último envio concluído ocorreu há pelo menos 10 dias (períodos de 24 horas).
O aviso é calculado ao abrir a página; não há agendamento de backups automáticos
nem envio de e-mail. Após baixar, atualize a página para remover o aviso.

O botão **Baixar backup** faz um POST autenticado em `/admin/backup`, restrito ao
perfil `admin` e protegido pelo token CSRF já utilizado pelo site. O arquivo é um
`.tar.gz`, com:

- `database.dump`: estrutura do banco e dados das tabelas, excluindo os registros
  de `public.users` e eventuais tabelas descendentes;
- `users.json`: dados de `public.users`, incluindo IDs e demais colunas, **sem
  `password_hash`**;
- `LEIA-ME.txt`: identificação e informações sobre o conteúdo.

A estrutura de `users` continua no dump, mas nenhum hash dessa tabela é exportado.
As colunas de usuários são descobertas pelo catálogo; hashes não são selecionados
pela consulta de exportação. O JSON e o dump usam o mesmo snapshot transacional.
Não são alterados usuários, senhas ou permissões no banco de origem. Este recurso
não implementa restauração: os usuários sem senha precisarão de tratamento próprio
caso ela seja necessária. Não é um backup dos arquivos do site, `.env`, configurações
do Railway ou papéis globais do servidor PostgreSQL.

## Ativação

1. Execute `migrations/20261010_add_database_backups.sql` no banco da aplicação.
   A tabela `database_backups` guarda início do snapshot, conclusão do envio,
   administrador, nome e tamanho do arquivo. Sem essa migração, o painel funciona,
   mas o aviso de backup não aparece e a exportação não está disponível.
2. Publique a aplicação com o `Dockerfile` da raiz, que instala Node.js 24,
   `pg_dump` 18 e `tar`. O Railway detecta o Dockerfile automaticamente; verifique
   se o serviço não tem uma configuração explícita de build conflitante.
3. Mantenha `DATABASE_URL` configurada no serviço web. A conta precisa ler o banco
   inteiro, incluindo as colunas não secretas de `users`, e inserir no histórico.
   Não use a conta de análise que não tem acesso a `users`.
4. Fora do Docker, instale PostgreSQL client 18 e `tar`; opcionalmente configure
   `PG_DUMP_PATH` com o caminho do executável. Um cliente mais antigo que o servidor
   pode não funcionar.

Não há alteração automática do banco durante a inicialização. Após a ativação,
teste um download com uma conta administradora e confira o conteúdo do pacote.

## Segurança e limitações

O pacote contém dados pessoais e comerciais: guarde-o em local protegido. Ele não
é criptografado. Credenciais de conexão não são passadas na linha de comando nem
incluídas no pacote. A exclusão cobre `public.users.password_hash`; se segredos
forem armazenados em outras tabelas no futuro, revise a política de exportação.

Arquivos temporários ficam em diretório privado e são removidos após conclusão,
erro ou cancelamento. Uma interrupção abrupta do processo pode deixar temporários
no disco efêmero. Um lock PostgreSQL permite apenas um backup por vez, inclusive
entre réplicas. A geração do dump e a compactação têm limite de cinco minutos cada.
O servidor precisa de espaço temporário para o dump e o pacote simultaneamente.

O histórico só é inserido após o servidor concluir o envio HTTP; isso não comprova
que o navegador salvou o arquivo em disco. Falhas/cancelamentos não devem adiar o
aviso. Se a gravação do histórico falhar após o envio, o aviso permanece. O próprio
backup contém apenas o histórico anterior a ele, pois o novo registro é posterior
ao snapshot.

Referências: [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)
(`--snapshot` e exclusão dos dados de tabelas) e
[Dockerfiles no Railway](https://docs.railway.com/builds/dockerfiles).
