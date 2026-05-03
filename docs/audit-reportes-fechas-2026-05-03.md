# Audit — Fonte da fecha em relatórios de cobrança/pagamento

**Data**: 2026-05-03
**Wave**: W2.5 do roadmap-7-cambios-2026-05-02
**Escopo**: estrito a `src/app/(dashboard)/reportes/`
**Veredito global**: ✓ **sem inconsistências**

## Premissa contábil

| Caso de uso | Fonte correta da fecha |
|---|---|
| Cobrança / pagamento (caja base, percibido) | `MovimientoTesoreria.fecha` |
| Resultados / IVA (devengado) | `Compra.fecha` / `Venta.fecha` / `Gasto.fecha` |
| Asientos contábeis em geral | `Asiento.fecha` (= fecha do documento, NÃO `new Date()`) |
| `createdAt` | quase nunca correto, é fecha do clic |

Esta premissa veio do roadmap mestre + ADR `2026-05-02-asientos-fecha-documento.md`, que já consertou os 2 únicos asientos que usavam `new Date()` (ZP e Cierre de embarque).

## Inventário de relatórios

| Relatório | Path | Categoria contábil | Em escopo W2.5? |
|---|---|---|---|
| Balance General | `reportes/balance-general/` | Saldos por Asiento.fecha (devengado por design) | ❌ fora |
| Estado de Resultados | `reportes/estado-resultados/` | Ingresos/Egresos por Asiento.fecha (devengado por design) | ❌ fora |
| Libro Diario | `reportes/libro-diario/` | Asientos por Asiento.fecha (design) | ❌ fora |
| Libro Mayor | `reportes/libro-mayor/` | Movimentos por cuenta, Asiento.fecha (design) | ❌ fora |
| **Flujo de Caja** | `reportes/flujo-caja/` | **Cash flow caja base** | ✅ **único** |

Os 4 relatórios marcados ❌ usam `Asiento.fecha` por design contábil — são relatórios contábeis, não de cobrança. Estão explicitamente fora do escopo da W2.5 (item de não-objetivos do roadmap).

## Auditoria — `Flujo de Caja`

### Caminho do dado

`reportes/flujo-caja/page.tsx` → `getFlujoCaja(desde, hasta, moneda)` → `src/lib/services/reportes/flujo-caja.ts`

### Filtros de fecha aplicados pelo service

[src/lib/services/reportes/flujo-caja.ts:96-108](src/lib/services/reportes/flujo-caja.ts#L96-L108) — saldo inicial:

```ts
const saldoInicialAgg = await db.lineaAsiento.aggregate({
  where: {
    asiento: {
      estado: AsientoEstado.CONTABILIZADO,
      fecha: { lt: desde },           // ← Asiento.fecha
      moneda,
    },
    cuenta: {
      OR: BANCO_CAJA_PREFIXES.map((p) => ({ codigo: { startsWith: p } })),
    },
  },
  _sum: { debe: true, haber: true },
});
```

[src/lib/services/reportes/flujo-caja.ts:115-128](src/lib/services/reportes/flujo-caja.ts#L115-L128) — asientos do período:

```ts
const asientos = await db.asiento.findMany({
  where: {
    estado: AsientoEstado.CONTABILIZADO,
    fecha: { gte: desde, lte: hasta },  // ← Asiento.fecha
    moneda,
    lineas: {
      some: {
        cuenta: {
          OR: BANCO_CAJA_PREFIXES.map((p) => ({ codigo: { startsWith: p } })),
        },
      },
    },
  },
  ...
});
```

[src/lib/services/reportes/flujo-caja.ts:150](src/lib/services/reportes/flujo-caja.ts#L150) — atribuição mensal:

```ts
const mes = mesKey(a.fecha);  // ← Asiento.fecha
```

### Cadeia de fecha: `Asiento.fecha` → fonte real

O relatório só carrega asientos que **tocam banco/caja** (linhas em cuentas com prefixo `1.1.1.*` ou `1.1.2.*`). Os únicos generators do sistema que produzem asientos com líneas em banco/caja são:

| Generator | Linha | Fecha de origem |
|---|---|---|
| `crearAsientoMovimientoTesoreria` | [asiento-automatico.ts:581](src/lib/services/asiento-automatico.ts#L581) | `mov.fecha` (= `MovimientoTesoreria.fecha`) ✓ |
| `crearAsientoTransferencia` | [asiento-automatico.ts:739](src/lib/services/asiento-automatico.ts#L739) | `input.fecha` (passada pela action) ✓ |
| Asiento manual (com líneas de banco) | n/a | `Asiento.fecha` escolhida pelo operador ✓ |

Os outros 2 generators que poderiam suspeitar — `crearAsientoZonaPrimaria` e `crearAsientoEmbarque` — **não tocam banco/caja** (são asientos de mercadería en tránsito + impuestos contra cuentas a pagar), portanto não influenciam este relatório. Já estão corrigidos pela ADR `2026-05-02-asientos-fecha-documento.md`.

### Veredito

✓ **Correto.** O `flujo-caja` filtra por `Asiento.fecha`, que para asientos que tocam banco/caja **sempre** corresponde a `MovimientoTesoreria.fecha` ou `Transferencia.fecha` (= fecha real do fato de caja). Não há leak de `Compra.fecha`, `Venta.fecha`, `Gasto.fecha` ou `createdAt` no caminho de dados.

## Conclusão

| Item | Status |
|---|---|
| Relatórios em escopo dentro de `/reportes/` | 1 (`flujo-caja`) |
| Relatórios com fecha incorreta | 0 |
| Issues a abrir | nenhum |
| Patches a propor | nenhum |
| Branches a criar | nenhum |

W2.5 fechada. Audit completo, sem inconsistências.

## Limitações deste audit

- **Escopo estrito**: pages sob `/tesoreria/*` (extracto, movimientos, cuentas-a-pagar, saldos-proveedores, prestamos) e widgets de `/dashboard/` **não** foram auditados. Eles podem mostrar fluxo financeiro com semântica de cobrança e merecem auditoria própria se aparecerem inconsistências de uso.
- **Pressuposto**: todo asiento que toca banco/caja vem de `MovimientoTesoreria` ou `Transferencia`. Se no futuro algum novo generator passar a produzir líneas de banco direto a partir de outro fato (ex: emissão de Venta com pago al contado em asiento único), esta auditoria precisa ser refeita — o atributo crítico passa a depender do generator novo.

## Referências

- ADR base: [`2026-05-02-asientos-fecha-documento.md`](../../sunset-tires-brain/04-decisions/2026-05-02-asientos-fecha-documento.md)
- Roadmap mestre: `00-project/roadmap-7-cambios-2026-05-02.md` (item W2.5)
- Sessão anterior: `03-sessions/2026-05-02-roadmap-7-fixes-w2-w2_5.md`
