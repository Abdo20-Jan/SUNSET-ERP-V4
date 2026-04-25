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
3. Aplique o schema e o seed **a partir da sua máquina local**, apontando para a URL direta:

   ```bash
   # Cria/atualiza tabelas no banco do Railway
   DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm db:push

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

> **Não rodamos `prisma db push` no build da Vercel.** Migrations são aplicadas manualmente a partir do passo 2.3 quando o schema mudar. Isso evita migrations acidentais em produção e dispensa o `DIRECT_DATABASE_URL` na Vercel.

## 4. Atualizações de schema

Quando `prisma/schema.prisma` mudar:

```bash
# Verifique o diff antes de aplicar
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm prisma migrate diff \
  --from-url "<DIRECT_DATABASE_URL>" \
  --to-schema-datamodel prisma/schema.prisma \
  --script

# Aplique
DATABASE_URL="<DIRECT_DATABASE_URL>" pnpm db:push
```

Após o `db:push`, a Vercel não precisa de redeploy — o cliente Prisma é regenerado em cada build, mas o runtime existente continua compatível com adições não-destrutivas. Para mudanças destrutivas (drop column, rename), faça redeploy logo após o `db:push`.

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
