# Runbook — Ativação Comex ZPA (desconsolidación + despacho parcial cruzado)

> **PR 6.4 — fecho do plano Comex ZPA.** Este runbook descreve o smoke de
> regressão zero (flag OFF), a ativação gradual da flag em produção e o
> rollback. **NÃO mergear/executar antes** de #136 (docs), #137 (invariantes)
> e #138 (e2e) estarem em `main`.
>
> **Status:** rascunho operacional. Os campos marcados `⟨…⟩` são decisões do
> operador (embarque piloto, janela, responsável) a preencher na execução.

---

## 1. Escopo — o que a flag liga

A flag **`CONTENEDOR_DESCONSOLIDACION_ENABLED`** é **global por ambiente**
(variável de ambiente, não há toggle por embarque). Quando `=true` habilita,
em conjunto:

- **Packing list por contêiner** — seção "Contenedores" no `embarque-form`
  (PR 2.3) + actions com optimistic locking (2.2).
- **Desconsolidación em depósito fiscal** — rota `comex/contenedores/[id]/desconsolidacion`
  (3.4), serviço `desconsolidar` (3.2): counters `cantidadDisponible`, asiento
  de traslado `1.1.5.05 / 1.1.5.04`, `MovimientoStock` INGRESO no DF.
- **Divergência D9** — gate na desconsolidación + investigação em
  `comex/contenedores/[id]/investigacion` (3.3/3.5), upload de evidências (Vercel Blob).
- **Despacho parcial cruzado** — matriz SKU×contêiner (4.4b), borrador →
  trava de counters single-shot (4.3) → contabilizar (asiento `1.1.5.01 / 1.1.5.05`
  + VEP 1:1, 4.5), anulação reversível + cron de cleanup (4.6).
- **Vistas** — aba **"Comex / Aduana"** no inventário (pipeline segmentado por fase,
  5.1/5.2) e seção **"Depósito fiscal · bonded"** no BI (valor USD, aging, 5.3).

Com a flag **OFF** (default): o fluxo legacy embarque-cêntrico opera sem mudança;
as tabelas `Contenedor`/`ItemContenedor`/`Desconsolidacion`/`DivergenciaInvestigacion`
existem mas ficam órfãs; os counters não são usados. **Zero regressão.**

> **`UNIDAD_INVENTARIO_TRACKING_ENABLED` permanece OFF.** D1-bis (rastreio
> unitário para recall/garantia) é dormente — não ativar neste runbook.

---

## 2. Pré-requisitos (antes de ligar a flag em QUALQUER ambiente)

| # | Item | Como verificar | Onde |
|---|------|----------------|------|
| 1 | Schema aplicado (`pnpm db:push`) — tabelas Fase 1 | `\dt` mostra `Contenedor`, `ItemContenedor`, `Desconsolidacion`, `DivergenciaInvestigacion`, `DespachoBorrador` | Railway (staging/prod) |
| 2 | Índices UNIQUE parciais do `ItemContenedor` | `pnpm db:partial-indexes-contenedor --apply` executado | Railway |
| 3 | Índices parciais + CHECK do `ItemDespacho` (despacho cruzado) | `pnpm db:partial-indexes-despacho` aplicado (ver `prisma/partial-indexes-despacho.ts`) | Railway |
| 4 | Subcontas contábeis criadas (cuenta-registry, 1.4) | existem `1.1.5.04` (ZPA), `1.1.5.05` (DF), `5.9.x` (perdas D9), `4.9.x` (sobra D9) | Plano de contas |
| 5 | `CRON_SECRET` provisionado | `GET /api/cron/cleanup-despachos-borrador` com `Authorization: Bearer $CRON_SECRET` → 200; sem header → 401 | Vercel env |
| 6 | `BLOB_READ_WRITE_TOKEN` provisionado (upload de evidências D9, 3.5) | upload de evidência funciona na tela de investigação | Vercel env |
| 7 | Cron diário registrado | `vercel.json` → `cleanup-despachos-borrador` em `0 3 * * *` (válido no plano Hobby: máx 1×/dia) | `vercel.json` |
| 8 | CI verde + invariantes diárias ativas | workflow `validar-stock.yml` rodando (6.2); última execução verde | GitHub Actions |

> ⚠️ **Itens 5 e 6 são bloqueantes**: sem `CRON_SECRET` o cron não roda; sem
> `BLOB_READ_WRITE_TOKEN` o upload de evidências de divergência falha.

---

## 3. Smoke com a flag OFF (regressão zero) — fazer primeiro em prod

Confirmar que, com `CONTENEDOR_DESCONSOLIDACION_ENABLED` **não setada / =false**
em produção, nada muda:

- [ ] Rota `comex/contenedores/[id]/desconsolidacion` → **404 (`notFound`)**.
- [ ] Rota `comex/contenedores/[id]/investigacion` → **404**.
- [ ] `embarque-form` em edição → **não** mostra a seção "Contenedores".
- [ ] Inventário → aba **"Comex / Aduana"** **não** aparece.
- [ ] BI → aba Stock → seção **"Depósito fiscal · bonded"** **não** renderiza.
- [ ] Tela de despachos → usa o **form legacy** (`crear-despacho-form`), não a matriz cruzada.
- [ ] `GET /api/cron/cleanup-despachos-borrador` (com Bearer correto) → **200 no-op** (flag OFF).
- [ ] Criar/editar/contabilizar/anular um **despacho legacy** end-to-end → comportamento idêntico ao de hoje.

**Critério:** todos os itens acima ✓ → prod estável com a infra Fase 1-6 presente
mas inerte. Pode prosseguir.

---

## 4. Ativação gradual

> A flag é **global**. "Piloto" = ligar a flag e exercer o fluxo num **único
> embarque real escolhido**, monitorando de perto, com rollback pronto (§6).

### 4.1 Staging primeiro
1. Setar `CONTENEDOR_DESCONSOLIDACION_ENABLED=true` em **staging**.
2. Rodar a suíte e2e (PR 6.1): `pnpm test:e2e` (Docker + `prisma generate`).
3. Rodar o validador de invariantes (PR 6.2) contra o banco de staging.
4. Exercer manualmente o happy-path completo (packing list → desconsolidación →
   despacho parcial cruzado → anulação) e conferir asientos balanceados.

### 4.2 Produção — embarque piloto
- **Embarque piloto:** `⟨código do embarque⟩`
- **Janela de ativação:** `⟨data/hora⟩`  ·  **Responsável:** `⟨nome⟩`
- **Rollback ready:** equipe ciente do §6.

Passos:
1. Setar `CONTENEDOR_DESCONSOLIDACION_ENABLED=true` em **prod** (Vercel env) e
   redeploy.
2. No embarque piloto, exercer o ciclo:
   - [ ] Carregar packing list por contêiner (Σ por SKU = `ItemEmbarque.cantidad`).
   - [ ] Desconsolidar contêiner **sem divergência** → estado `DESCONSOLIDADO`,
         asiento `1.1.5.05 / 1.1.5.04` balanceado, `MovimientoStock` INGRESO no DF.
   - [ ] (opcional) Forçar **divergência** num 2º contêiner → `AGUARDANDO_INVESTIGACAO`,
         asiento bloqueado; concluir investigação → asiento de ajuste por causa.
   - [ ] **Despacho parcial cruzado**: reservar borrador na matriz → contabilizar →
         asiento `1.1.5.01 / 1.1.5.05` + custo landed por linha + VEP; estado do
         contêiner → `PARCIALMENTE_DESPACHADO` / `TOTALMENTE_DESPACHADO`.
   - [ ] **Anular** o despacho → counters/stock/asiento revertidos (período aberto).

### 4.3 Checklist de validação pós-piloto
- [ ] **Libro mayor balanceado**: Σ DEBE = Σ HABER em todos os asientos gerados.
- [ ] **BI bonded bate**: valor USD em DF = Σ `cantidadDisponible × costoFCUnitario`;
      aging coerente; despachos abertos refletem os counters `cantidadEnDespacho`.
- [ ] **Aba "Comex / Aduana"**: as 4 colunas (EN_TRANSITO/EN_ZPA/EN_DF/EN_DESPACHO)
      somam o esperado para o embarque piloto.
- [ ] **Invariantes (6.2)** rodadas manualmente → 0 violações:
      counters consistentes; nenhum borrador vencido com lock pendente; nenhuma
      investigação > 7 dias.
- [ ] **Cron**: na próxima execução diária (`0 3 * * *`), borradores vencidos
      expiram e liberam counters.

---

## 5. Monitoramento (primeiras 2 semanas)

- **Invariantes diárias** — workflow `validar-stock.yml` (abre issue automática em
  violação). Acompanhar.
- **Cron de cleanup** — conferir logs de `/api/cron/cleanup-despachos-borrador`
  (deve rodar 1×/dia; reverter `countsTrabados` de borradores `EXPIRADO`).
- **Asientos** — auditar periodicamente o balanceamento dos asientos comex.
- **Erros de saldo** — `SALDO_INSUFICIENTE` (≈409) em despacho cruzado é esperado
  sob concorrência (single-shot); investigar só se recorrente sem concorrência real.

---

## 6. Rollback

A flag é reversível e o desenho é defensivo:

1. **Desligar** `CONTENEDOR_DESCONSOLIDACION_ENABLED` (set `false` / remover) + redeploy.
2. Efeito imediato: rotas comex/contenedores voltam a 404, abas/seções somem, o
   fluxo de despachos volta ao **legacy**. **Os dados criados permanecem** no banco
   (contêineres, counters, borradores) — ficam inertes, sem corromper o legacy.
3. **Asientos/stock já gerados**: reverter via `anularDespachoAction` (4.6 —
   reverte counters + transferência + asiento na mesma transação, gate de período
   aberto) **antes** de desligar a flag, se for preciso desfazer um despacho piloto.
   Período fechado → rollback total da anulação (não desbalanceia).
4. Borradores em aberto: expiram pelo cron, ou desligar a flag os deixa inertes
   (os counters podem ser liberados manualmente via `expirarBorradorAction` antes do OFF).

> **Não** desligar a flag deixando um despacho cruzado **contabilizado** sem antes
> decidir se será anulado — o asiento permanece no libro mayor (correto), mas a UI
> de operação some. Anular antes do OFF se o piloto deve ser revertido.

---

## 7. Go / No-Go

| Critério | Go |
|----------|-----|
| Smoke flag OFF (§3) 100% ✓ | ☐ |
| Pré-requisitos (§2) 1-8 ✓ (5 e 6 obrigatórios) | ☐ |
| Staging exercido (§4.1) sem erro | ☐ |
| Libro mayor balanceado no piloto | ☐ |
| BI bonded + pipeline batem (§4.3) | ☐ |
| Invariantes 0 violações | ☐ |
| Rollback ensaiado / equipe ciente | ☐ |

**Decisão:** `⟨Go / No-Go⟩` — `⟨responsável⟩` — `⟨data⟩`.

---

## 8. Pós-ativação — follow-ups vivos

- **DRY do asiento legacy** — `crearAsientoDespacho` legacy duplica tributos/facturas
  de propósito (sem testes, ativo em prod). Unificar quando o legacy ganhar testes.
- **Int×uuid restante** — alinhar `Desconsolidacion.usuarioId` e
  `DivergenciaInvestigacion.closedBy` (hoje omitidos nas actions por mismatch).
- **Gatilhos não cabeados** — `ARRIBO_ZONA_PRIMARIA` e `NACIONALIZACION_DIRECTA`
  têm asiento no helper mas ainda sem action que os dispare (ver #136).
- **e2e browser-driven** — os e2e atuais (6.1) exercem os services; um nível
  browser-driven (Next + NextAuth) fica como follow-up.
- **D1-bis** — `UNIDAD_INVENTARIO_TRACKING_ENABLED` segue dormente até o módulo de
  recall ser planejado.
