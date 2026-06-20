# NS-4 PR-2 · audit-trail + instrumentar Proveedores — Implementation Plan

> Execução inline. Audit-trail por record: helper central + reader + diff + timeline, e instrumentar o domínio Proveedor (o piloto) para o trail ter dados reais.

**Goal:** histórico de mudanças (CREATE/UPDATE/DELETE) por record, exibido como timeline numa tab "Historial" no detalhe de Proveedor. Helper central `registrarAuditoria` reutilizável + reader `getAuditLog` + diff puro + `<AuditTrail>`.

**Architecture:** `registrarAuditoria(tx, …)` grava `AuditLog` dentro da mesma transação da mutação (atômico). As 3 actions de Proveedor passam a usar `requireSessionUser()` (valida que o User existe/ativo ANTES de escrever a FK `AuditLog.usuarioId` — evita P2003/rollback num projeto com reseed frequente) e gravam snapshots. O reader + diff puro alimentam a timeline.

**Tech Stack:** Prisma 7.8 (Json `InputJsonValue`/`JsonNull`), Next 16 RSC, vitest node.

## Global Constraints
- `AuditLog.usuarioId` é FK obrigatória → SEMPRE obter o id via `requireSessionUser()` (não `session.user.id` cru): valida existência+ativo, evita P2003 no reseed. Chamar no TOPO da action, FORA de try/catch (redirect lança NEXT_REDIRECT).
- Audit gravado DENTRO do `$transaction` da mutação (atômico: ou muda + audita, ou nada).
- Snapshots só com campos JSON-safe (String/Int/null) do Proveedor; sem Decimal/Date.
- `tabla` = nome do model Prisma ("Proveedor"), consistente com o site de retenciones ("RetencionPracticada").

---

### Task 1: Diff puro `src/lib/auditoria-diff.ts` (TDD)
`diffAuditoria(anteriores: unknown, nuevos: unknown): CampoDiff[]` onde `CampoDiff = {campo, antes: string|null, despues: string|null}`. Trata null como `{}`; união de chaves; inclui só onde `antes !== despues`; `fmt(null|undefined)=null` senão `String(v)`. Cobre CREATE (anteriores null→todos), UPDATE (só mudados), DELETE (nuevos null→todos), sem-mudança ([]). Testes em `test/auditoria-diff.test.ts`.

### Task 2: Serviço `src/lib/services/auditoria.ts` (server-only)
- `registrarAuditoria(tx: Pick<Prisma.TransactionClient,"auditLog">, { tabla, registroId, accion, datosAnteriores?, datosNuevos?, usuarioId }): Promise<void>` → `tx.auditLog.create` com `Prisma.JsonNull` quando ausente.
- `getAuditLog(tabla, registroId): Promise<AuditEntry[]>` → `db.auditLog.findMany({where, orderBy fecha desc, include usuario{nombre,username}})` → mapeia `AuditEntry = {id, accion, fecha, usuario, datosAnteriores, datosNuevos}` (usa `@@index([tabla,registroId])`).

### Task 3: `src/components/ui/audit-trail.tsx`
`<AuditTrail entries={AuditEntry[]} />` timeline: por entry, badge da accion (Creó/Modificó/Eliminó) + "por {usuario} · {fecha}" + lista de `diffAuditoria` (campo: antes → despues). Empty state. Presentacional (server-ok).

### Task 4: Instrumentar `src/lib/actions/proveedores.ts` (3 actions)
`SNAPSHOT_SELECT` = {nombre,cuit,pais,tipoProveedor,email,telefono,condicionPagoDefault,diasPagoDefault,estado,cuentaContableId,cuentaGastoContableId}.
- **crear**: top `const usuarioId = await requireSessionUser()` (remove `auth()`/`{ok:false No autorizado}`); `create({select: {id, ...SNAPSHOT}})`; `registrarAuditoria(tx,{tabla:"Proveedor",registroId:id,accion:"CREATE",datosNuevos:snapshot,usuarioId})`.
- **actualizar**: top `requireSessionUser`; dentro do tx `antes = findUnique(SNAPSHOT)`, `update(select SNAPSHOT)` = `despues`, `registrarAuditoria(accion:"UPDATE",datosAnteriores:antes,datosNuevos:despues)`.
- **eliminar**: top `requireSessionUser`; envolver em `$transaction`; `antes = findUnique(SNAPSHOT)`; soft (update estado inactivo) → `accion:"UPDATE"` datosAnteriores=antes/datosNuevos={...antes,estado:"inactivo"}; hard (delete) → `accion:"DELETE"` datosAnteriores=antes.

### Task 5: Tab "Historial" em `proveedores/[id]/page.tsx`
Adicionar tab "historial" à allowlist + `RecordTabs`; count via `db.auditLog.count({where:{tabla:"Proveedor",registroId:id}})`; render `<AuditTrail entries={await getAuditLog("Proveedor", id)} />`.

### Gates
typecheck · eslint · biome (escopo) · vitest · `pnpm build`. Review adversarial opus whole-branch → PR → auto-merge. SEM schema (AuditLog já existe). Validação visual prod não-essencial (trail real só após mutações).

### Próximo (NS-4)
PR-3+ rollout do shell (venta resolve órfã Entregas, asiento, embarque, cliente) + estender audit a mais domínios. Depois NS-5.
