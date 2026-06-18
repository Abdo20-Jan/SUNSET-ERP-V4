# Deploy — Sunset Tires ERP

Guia de deploy para a arquitetura **Railway (PostgreSQL) + Vercel (Next.js)**.

## 1. Variáveis de ambiente

| Variável               | Onde                | Descrição                                                                 |
| ---------------------- | ------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`         | Vercel + local prod | Connection string usada em runtime. Em produção, use o **pooler** do Railway com `?pgbouncer=true&connection_limit=1`. |
| `DIRECT_DATABASE_URL`  | Local prod          | Connection string **direta** (sem pooler) — usada apenas para `prisma db push` / `prisma db seed`. Não precisa estar na Vercel. |
| `AUTH_SECRET`          | Vercel              | Gere com `openssl rand -base64 32`. Mesmo valor para todos os deploys.    |
| `AUTH_URL`             | Vercel              | URL canônica da aplicação, ex.: `https://sunset-erp.vercel.app`.          |

Veja `.env.example` para o template.

## 2. Banco de dados (Railway)

1. Em [railway.app](https://railway.app), crie um projeto e provisione um serviço **PostgreSQL**.
2. Em *Settings → Networking*, copie:
   - **Postgres Connection URL** (direta) → use como `DIRECT_DATABASE_URL`.
   - **Postgres Pooler URL** (PgBouncer) → use como `DATABASE_URL` em produção. Anexe `?pgbouncer=true&connection_limit=1`.
3. Aplique as migrations e o seed **a partir da sua máquina local**, apontando para a URL direta:

   ```bash
   # Cria as tabelas aplicando as migrations versionadas (baseline 0_init + …)
   DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm db:migrate:deploy

   # Insere plano de contas, períodos, usuário admin/admin123, etc.
   DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm db:seed
   ```

   > Use a URL **direta** para migrations e seed. O pooler PgBouncer não suporta DDL/transações longas usadas pelo Prisma.

## 3. Aplicação (Vercel)

1. Conecte o repositório GitHub à Vercel (*Add New → Project*).
2. Em *Build & Development Settings*, deixe os defaults — a Vercel detecta Next.js automaticamente:
   - Build Command: `pnpm build` (já roda `prisma generate` via `postinstall`).
   - Install Command: `pnpm install`.
3. Em *Environment Variables* (escopo **Production** + **Preview**), defina:
   - `DATABASE_URL` → pooler URL do Railway com `?pgbouncer=true&connection_limit=1`.
   - `AUTH_SECRET` → segredo gerado.
   - `AUTH_URL` → URL canônica da Vercel.
4. Clique *Deploy*.

> **Não aplicamos schema no build da Vercel.** As migrations rodam pela GitHub Action `migrate-deploy` ao mergear em `main` (ver §4). Isso evita migrations acidentais no build e dispensa credenciais de banco na Vercel.

## 4. Atualizações de schema (migrations versionadas)

O projeto usa **Prisma Migrate** — não mais `prisma db push` manual em produção. O baseline vive em `prisma/migrations/0_init`. Fluxo para qualquer mudança de schema:

1. **Local** — edite `prisma/schema.prisma` e gere a migration:

   ```bash
   pnpm db:migrate      # = prisma migrate dev → cria prisma/migrations/<timestamp>_<nome>
   ```

2. **Commit** o diretório `prisma/migrations/**` gerado junto com o código e abra o PR.

3. **Merge em `main`** → a GitHub Action `migrate-deploy` (`.github/workflows/migrate-deploy.yml`) roda `prisma migrate deploy` em produção automaticamente. **Não há mais passo manual de `db push`.**

   > **Secret:** a Action reusa `DATABASE_URL_PROD` (o mesmo secret repo-level que `validar-stock.yml` já usa). Ele DEVE ser a connection string **direta** do Railway (sem pooler) — o `migrate deploy` usa advisory locks/DDL incompatíveis com o PgBouncer em transaction-pooling. Como o prod atual não usa pooler, o secret já é direto; nada novo a criar.

### Adoção do baseline em banco já existente (one-time)

O prod foi construído com `db push`, não com migrations. Para adotá-lo sob `prisma migrate` **sem recriar dados**, rode UMA vez (com a URL direta), **ANTES do primeiro merge** que introduz `prisma/migrations/` — senão a Action tentará rodar os `CREATE TABLE` do `0_init` sobre tabelas que já existem e a migration ficará marcada como *failed*:

```bash
# 0) Backup
pg_dump "<DIRECT_DATABASE_URL>" > backup-pre-baseline.sql

# 1) Gate de drift — DEVE sair vazio (exit 0). Se houver ALTER, PARAR.
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code

# 2) Marca o baseline como já aplicado SEM rodar o SQL (cria _prisma_migrations)
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm exec prisma migrate resolve --applied 0_init

# 3) Confirma
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm db:migrate:status   # "Database schema is up to date"
```

Depois disso, todo merge com novas migrations é aplicado pela Action. (Banco do ZERO — ex.: setup local de §2.3 — usa `db:migrate:deploy` direto, que roda o `0_init` por inteiro.)

### Preview do drift antes de aplicar (read-only)

```bash
# Prisma 7: NÃO existe mais --from-url / --to-schema-datamodel.
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm prisma migrate diff \
  --from-config-datasource \
  --to-schema prisma/schema.prisma \
  --exit-code        # 0 = em sync · 2 = há drift · 1 = erro
```

### Aplicar manualmente (fallback — ex.: a Action falhou)

```bash
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm db:migrate:deploy
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm db:migrate:status   # confirma "up to date"
```

Para adições **não-destrutivas** a Vercel não precisa de redeploy (o cliente Prisma é regenerado em cada build). Para mudanças **destrutivas** (drop/rename column), faça `pg_dump` de backup antes e redeploy logo após. Use sempre a **URL direta** (sem pooler) para qualquer comando `prisma migrate`.

## 5. Smoke test pós-deploy

1. Acesse `AUTH_URL` → deve redirecionar para `/login`.
2. Login com `admin / admin123` → redireciona para `/dashboard`.
3. Verifique:
   - **Dashboard** carrega métricas e alertas.
   - **Maestros / Clientes** lista clientes do seed.
   - **Contabilidad / Cuentas** mostra plano de contas em árvore.
   - **Reportes / Balance General** renderiza sem erro.
4. Crie um cliente de teste → toast verde e linha aparece na tabela.

## 6. Rollback

- Vercel: *Deployments → Promote to Production* na build anterior.
- Banco: o Railway mantém backups diários (Postgres → *Backups*). Restore para snapshot anterior se uma migration corromper dados.

## 7. Backups lógicos próprios (pg_dump portável)

Além dos backups nativos do Railway, mantemos uma cópia **lógica e portável** (`pg_dump`), restaurável em qualquer Postgres 18.

> ⚠️ **Versão do `pg_dump`**: o servidor de prod roda **Postgres 18**. Um `pg_dump` local mais antigo (ex.: Homebrew 16) aborta com `server version mismatch`. Por isso sempre dumpamos via a imagem `postgres:18-alpine` (Docker) — sem instalar nada no host.

**Manual (sob demanda — rode SEMPRE antes de qualquer operação de risco em prod):**

```bash
# lê DATABASE_URL de .env.local (ou passe via env). Requer Docker rodando.
pnpm db:backup:prod
# → ~/sunset-backups/sunset-prod-AAAAMMDD-HHMMSS.sql.gz  (valida + poda > 30 dias)
```

**Automático (diário):** a GitHub Action `.github/workflows/backup-prod.yml` roda o mesmo `pg_dump` às 03:00 UTC e guarda o `.sql.gz` como *artifact* (retenção 30 dias). Usa o secret `DATABASE_URL_PROD` (o mesmo de `migrate-deploy`). Dá para disparar à mão em *Actions → backup-prod → Run workflow*.

**Restaurar** (num Postgres 18 descartável para inspecionar — **nunca** direto em prod):

```bash
docker run -d --name pg-restore -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=restore -p 55433:5432 postgres:18-alpine
gunzip -c sunset-prod-AAAAMMDD-HHMMSS.sql.gz | docker exec -i pg-restore psql -U postgres -d restore
docker exec pg-restore psql -U postgres -d restore -tA -c 'SELECT count(*) FROM "CuentaContable";'
docker rm -f pg-restore
```
