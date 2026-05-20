# Backfill — Contenedor virtual (embarques legados)

**PR 2.4 · Decisão D7 (migração lazy)**

## Contexto

Os embarques anteriores ao modelo de contêineres (Fase 1) não têm
`Contenedor`/`ItemContenedor`. Para que o fluxo novo (Fases 2–4) opere
sobre um embarque legado, ele precisa ganhar **um contêiner virtual** que
envolve todo o packing list (1 `ItemContenedor` por `ItemEmbarque`).

A migração é **lazy**: não roda `UPDATE` massivo ao ativar a flag. O
contêiner virtual é criado **sob demanda, por embarque**, quando o
embarque é tocado por uma operação nova — ou manualmente via este script.
O universo é pequeno (~5 embarques históricos).

## Script

`prisma/backfill-contenedor-virtual.ts` — idempotente, **dry-run por
default**.

```bash
# dry-run de um embarque (não escreve)
pnpm tsx prisma/backfill-contenedor-virtual.ts --embarque <id>

# aplicar a um embarque
pnpm tsx prisma/backfill-contenedor-virtual.ts --embarque <id> --apply

# dry-run de todos os embarques sem contêiner
pnpm tsx prisma/backfill-contenedor-virtual.ts --all

# aplicar a todos
pnpm tsx prisma/backfill-contenedor-virtual.ts --all --apply
```

### O que cria

- 1 `Contenedor` por embarque, `numeroContenedor = VIRTUAL-<codigo>`,
  `estado` mapeado de `Embarque.estado`:

  | EmbarqueEstado | ContenedorEstado |
  |---|---|
  | BORRADOR | BORRADOR |
  | EN_TRANSITO | EN_TRANSITO |
  | EN_PUERTO | ARRIBADO_PUERTO |
  | EN_ZONA_PRIMARIA | EN_ZONA_PRIMARIA |
  | EN_ADUANA | EN_DEPOSITO_FISCAL |
  | DESPACHADO | DESCONSOLIDADO |
  | EN_DEPOSITO | DESCONSOLIDADO |
  | CERRADO | TOTALMENTE_DESPACHADO |

- 1 `ItemContenedor` por `ItemEmbarque`: `cantidadDeclarada = cantidad`,
  `cantidadFisica = cantidad`, `costoFCUnitario = ItemEmbarque.costoUnitario`.

### Idempotência

Embarques que já têm contêineres são pulados (`contenedores: { none: {} }`).
Rodar de novo é seguro.

## Limitação conhecida (deferida a Fase 2/3)

Os counters (`cantidadDisponible` / `cantidadEnDespacho` /
`cantidadDespachada`) ficam em **0**. A reconciliação de quanto ainda
está disponível vs já despachado num embarque legado (lendo
`StockPorDeposito` + despachos existentes) é resolvida quando o embarque é
efetivamente **tocado** por uma operação nova, não neste backfill
estrutural. Antes disso, o contêiner virtual é só o esqueleto de packing
list.

## Pré-requisitos

1. `pnpm db:push` da Fase 1 executado.
2. Flag `CONTENEDOR_DESCONSOLIDACION_ENABLED` ativada no ambiente alvo
   (o script não exige a flag, mas criar contêineres virtuais só faz
   sentido com o fluxo novo ligado).
