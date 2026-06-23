# 07 — Auditoria do Histórico / Trilha de Auditoria

> Baseline: G-07 / CRIT-11 / `07_PERMISSIONS_AUDIT_SECURITY.md` (AUD-01). Toda alteração relevante = **antes/depois + usuário + data/hora + motivo + origem**, imutável e permanente. AUD-01 exige **9 campos** + 8 tipos de evento.

## Modelo atual

```prisma
model AuditLog {                 // prisma/schema.prisma:1991
  id              Int      @id @default(autoincrement())
  tabla           String
  registroId      String
  accion          AuditAccion    // CREATE | UPDATE | DELETE
  datosAnteriores Json?          // ✅ antes
  datosNuevos     Json?          // ✅ depois
  usuarioId       String         // ✅ usuário
  fecha           DateTime @default(now())   // ✅ data/hora
  usuario User @relation(...)
  @@index([usuarioId]); @@index([tabla, registroId])
}
```

## Suporte presente

| capacidade AUD-01 | presente? | observação |
|---|---|---|
| Antes/depois (`datosAnteriores`/`datosNuevos`) | ✅ | snapshot JSON |
| Usuário | ✅ | `usuarioId` (FK) |
| Data/hora | ✅ | `fecha` |
| Campo alterado | ◐ | derivável do diff dos JSON, não explícito |
| Valor anterior / novo | ✅ | dentro do JSON |
| **Motivo / justificativa** | ❌ | **sem campo `motivo`** no `AuditLog` |
| **Origem** (Manual/Importação/Automação/API/Master override) | ❌ | **sem campo `origen`** no `AuditLog` |
| Documento vinculado | ❌ | ausente |
| IP / dispositivo / sessão | ❌ | ausente |
| Imutável (nem Master apaga) | ◐ | sem `update`/`delete` exposto, mas **não há regra/forçamento explícito** |
| Retenção permanente | ◐ | sem política declarada |

## Cobertura real (onde grava)

`db.auditLog.create(...)` é chamado em **apenas 3 lugares**, todos no contexto fiscal de retenções:
- [src/lib/actions/admin-percepcion-iibb.ts:101](../../src/lib/actions/admin-percepcion-iibb.ts#L101)
- [src/lib/actions/retenciones.ts:219](../../src/lib/actions/retenciones.ts#L219)
- [src/lib/services/retencion-ganancias-pago.ts:364](../../src/lib/services/retencion-ganancias-pago.ts#L364)

➡️ **A trilha de auditoria NÃO é sistemática.** Mutações sensíveis em Ventas, Asientos, Tesouraria, Comex, Pagos, etc. **não escrevem `AuditLog`**. Isto é o maior gap vs CRIT-11.

## Suporte parcial de "motivo/origem" fora do AuditLog
- `Asiento.origen` (`AsientoOrigen`: MANUAL/TESORERIA/COMEX/AJUSTE/GASTO) — é **origem de negócio do asiento**, não a "origem de auditoria" de AUD-01. Útil, mas não substitui.
- `motivoAnulacion String?` (~`prisma/schema.prisma:2069`) — motivo **só de anulação** em um model; não cobre alteração de valor/custo/câmbio/vencimento (PAGE-STD-02 exige motivo no salvar).
- Vários fluxos pedem confirmação/motivo em UI ad-hoc, mas **sem persistir antes/depois** nem evento.

## UI de auditoria
- **`AuditTimeline` não existe.** Páginas de registro não têm aba `Historial/Auditoría` padronizada (PAGE-STD-02 exige última aba = Historial + `Ver auditoría`/Alt+A). **AUD-01 (página de Auditoria) ausente.**

## Leitura sensível / export tracking
- ❌ Nenhum rastreamento de **visualização de custo/margem/saldo** nem de **exportação** (AUD-01 evento `VISUALIZACIÓN_SENSÍVEL`/`EXPORTACIÓN`). Liga-se ao gap de permissão ([06_PERMISSION_AUDIT.md](06_PERMISSION_AUDIT.md)).

## Status change tracking
- Mudanças de estado (BORRADOR→CONTABILIZADO→ANULADO, embarque, container) são controladas por máquina de estado nos serviços, mas **não geram evento `CAMBIO_ESTADO` no `AuditLog`** de forma uniforme.

## Gaps priorizados
1. 🔴 **Estender `AuditLog`** com `motivo`, `origen` (enum), `documentoId?`, `ip?`/`sesion?` — **mudança de schema → requer aprovação** (toca migração; ver [13_OPEN_QUESTIONS_FOR_OWNER.md](13_OPEN_QUESTIONS_FOR_OWNER.md)).
2. 🔴 **Serviço central de auditoria** (`registrarAuditoria({tabla, registroId, accion, antes, depois, motivo, origen, userId})`) chamado em toda mutation sensível.
3. 🔴 **Imutabilidade forçada** (sem update/delete; idealmente constraint/trigger ou revogação de permissão DML) + retenção permanente declarada.
4. 🟠 **`AuditTimeline` (UI)** + aba `Historial` padronizada + **página AUD-01**.
5. 🟠 **Auditar leitura sensível e export** (eventos `VISUALIZACIÓN_SENSÍVEL`/`EXPORTACIÓN`).

> Sequência: PR-005 entrega o **schema estendido + serviço central + `AuditTimeline`**; cada PR de módulo passa a **chamar o serviço** em suas mutations. Teste obrigatório por PR: "alteração sensível grava evento antes/depois com motivo" ([09_TESTING_QA_AUDIT.md](09_TESTING_QA_AUDIT.md)).
