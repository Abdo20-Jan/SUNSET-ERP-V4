/**
 * Diagnóstico completo de TODOS os artefatos vinculados aos embarques
 * AR-251223-036CN e AR-251020-007CN antes de qualquer exclusão.
 *
 * Inventario:
 *   - Embarque (asientoId cierre, asientoZonaPrimariaId)
 *   - EmbarqueCosto (com asientoId próprio + AplicacionPago)
 *   - Despacho (com asientoId, items, transferencias, vep)
 *   - ItemEmbarque + ItemDespacho
 *   - MovimientoStock (vinculados a ItemEmbarque ou ItemDespacho)
 *   - VepDespacho + MovimientoTesoreria vinculado
 *   - Transferencia (vinculadas ao Despacho)
 *   - Asientos completos (cierre, ZP, despachos, costos) + LineaAsiento
 *
 * Uso:
 *   pnpm tsx prisma/diag-embarques-target.ts
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const TARGETS = ["AR-251223-036CN", "AR-251020-007CN"];

async function inspect(codigo: string) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`EMBARQUE: ${codigo}`);
  console.log(`${"=".repeat(78)}`);

  const emb = await prisma.embarque.findUnique({
    where: { codigo },
    include: {
      proveedor: { select: { nombre: true } },
      depositoDestino: { select: { nombre: true } },
      depositoZonaPrimaria: { select: { nombre: true } },
      pedidoCompra: { select: { numero: true } },
      asiento: { select: { id: true, numero: true, estado: true, descripcion: true } },
      asientoZonaPrimaria: { select: { id: true, numero: true, estado: true, descripcion: true } },
      items: { include: { producto: { select: { codigo: true, nombre: true } } } },
      costos: {
        include: {
          proveedor: { select: { nombre: true } },
          asiento: { select: { id: true, numero: true, estado: true, descripcion: true } },
          lineas: true,
          aplicacionesPago: true,
        },
      },
      despachos: {
        include: {
          asiento: { select: { id: true, numero: true, estado: true, descripcion: true } },
          items: { include: { itemEmbarque: { select: { id: true, productoId: true } } } },
          costos: { select: { id: true, facturaNumero: true } },
          transferencias: true,
          vep: { include: { movimientoTesoreria: { select: { id: true, asientoId: true } } } },
        },
      },
    },
  });

  if (!emb) {
    console.log(`Embarque NO ENCONTRADO.`);
    return null;
  }

  console.log(`\n— Header`);
  console.log(`  id              : ${emb.id}`);
  console.log(`  proveedor       : ${emb.proveedor.nombre}`);
  console.log(`  estado          : ${emb.estado}`);
  console.log(
    `  depositoDestino : ${emb.depositoDestino?.nombre ?? "(null)"}  ZP: ${emb.depositoZonaPrimaria?.nombre ?? "(null)"}`,
  );
  console.log(`  pedidoCompra    : ${emb.pedidoCompra?.numero ?? "(null)"}`);
  console.log(`  fechaCierre     : ${emb.fechaCierre?.toISOString() ?? "(null)"}`);
  console.log(`  fechaZonaPrim.  : ${emb.fechaZonaPrimaria?.toISOString() ?? "(null)"}`);

  console.log(`\n— Asientos do header`);
  console.log(
    `  cierre asientoId          : ${emb.asientoId ?? "(null)"}  → ${emb.asiento ? `#${emb.asiento.numero} ${emb.asiento.estado} "${emb.asiento.descripcion}"` : "(sem asiento)"}`,
  );
  console.log(
    `  asientoZonaPrimariaId     : ${emb.asientoZonaPrimariaId ?? "(null)"}  → ${emb.asientoZonaPrimaria ? `#${emb.asientoZonaPrimaria.numero} ${emb.asientoZonaPrimaria.estado} "${emb.asientoZonaPrimaria.descripcion}"` : "(sem asiento)"}`,
  );

  console.log(`\n— Items (${emb.items.length})`);
  for (const it of emb.items) {
    console.log(
      `  #${it.id} ${it.producto.codigo} ${it.producto.nombre} qty=${it.cantidad} fob=${it.precioUnitarioFob} costoU=${it.costoUnitario}`,
    );
  }

  console.log(`\n— EmbarqueCostos (${emb.costos.length})`);
  for (const c of emb.costos) {
    console.log(
      `  #${c.id} ${c.proveedor.nombre} ${c.facturaNumero ?? "(sem nº)"} estado=${c.estado} momento=${c.momento}`,
    );
    if (c.asiento) {
      console.log(
        `      asiento #${c.asiento.numero} ${c.asiento.estado} "${c.asiento.descripcion}"`,
      );
    } else {
      console.log(`      sem asiento (LEGACY_BUNDLED ou sem emisión)`);
    }
    console.log(`      ${c.lineas.length} línea(s), ${c.aplicacionesPago.length} aplicación(es)`);
    for (const apl of c.aplicacionesPago) {
      console.log(`         APL→ lineaAsiento#${apl.lineaAsientoId} ARS ${apl.montoArs}`);
    }
  }

  console.log(`\n— Despachos (${emb.despachos.length})`);
  for (const d of emb.despachos) {
    console.log(`  ${d.codigo} estado=${d.estado} numeroOM=${d.numeroOM ?? "(null)"}`);
    if (d.asiento) {
      console.log(
        `      asiento #${d.asiento.numero} ${d.asiento.estado} "${d.asiento.descripcion}"`,
      );
    } else {
      console.log(`      sem asiento`);
    }
    console.log(`      ${d.items.length} itemDespacho, ${d.costos.length} costos linkeados`);
    console.log(`      ${d.transferencias.length} transferencia(s)`);
    for (const t of d.transferencias) {
      console.log(`         Transferencia ${t.id} estado=${t.estado}`);
    }
    if (d.vep) {
      console.log(
        `      VepDespacho id=${d.vep.id} estado=${d.vep.estado} mov=${d.vep.movimientoTesoreriaId ?? "(null)"}`,
      );
    }
  }

  // Movimientos de stock vinculados aos items deste embarque
  const itemIds = emb.items.map((i) => i.id);
  const movs = await prisma.movimientoStock.findMany({
    where: { itemEmbarqueId: { in: itemIds } },
    select: {
      id: true,
      tipo: true,
      cantidad: true,
      costoUnitario: true,
      fecha: true,
      depositoId: true,
      productoId: true,
      itemEmbarqueId: true,
      itemDespachoId: true,
    },
    orderBy: { fecha: "asc" },
  });
  console.log(`\n— MovimientoStock vinculados a ItemEmbarque (${movs.length})`);
  for (const m of movs) {
    console.log(
      `  #${m.id} ${m.tipo} qty=${m.cantidad} costoU=${m.costoUnitario} fecha=${m.fecha.toISOString().slice(0, 10)} depósito=${m.depositoId.slice(0, 8)}…`,
    );
  }

  // Stock por depósito atual (saldo) dos productos deste embarque
  const productosUnicos = [...new Set(emb.items.map((i) => i.productoId))];
  const stocksProductos = await prisma.stockPorDeposito.findMany({
    where: { productoId: { in: productosUnicos } },
    include: {
      producto: { select: { codigo: true, nombre: true } },
      deposito: { select: { nombre: true, tipo: true } },
    },
  });
  console.log(`\n— Stock atual dos productos do embarque (todos depósitos)`);
  for (const s of stocksProductos) {
    if (s.cantidadFisica === 0 && Number(s.costoPromedio) === 0) continue;
    console.log(
      `  ${s.producto.codigo.padEnd(20)} ${s.deposito.tipo.padEnd(14)} ${s.deposito.nombre.padEnd(30)} qty=${s.cantidadFisica} reservada=${s.cantidadReservada} costoProm=${s.costoPromedio}`,
    );
  }

  // Calcular IDs de asientos para somar lineas
  const asientoIds: string[] = [];
  if (emb.asientoId) asientoIds.push(emb.asientoId);
  if (emb.asientoZonaPrimariaId) asientoIds.push(emb.asientoZonaPrimariaId);
  for (const c of emb.costos) {
    if (c.asientoId) asientoIds.push(c.asientoId);
  }
  for (const d of emb.despachos) {
    if (d.asientoId) asientoIds.push(d.asientoId);
  }
  const lineasAsientos = await prisma.lineaAsiento.count({
    where: { asientoId: { in: asientoIds } },
  });
  console.log(`\n— TOTAL asientos linkados: ${asientoIds.length}, ${lineasAsientos} línea(s)`);

  // Detectar asientos ÓRFÃOS via descripção (CONTABILIZADO/ANULADO com texto
  // deste embarque mas SEM FK no schema — resultado do race condition).
  const orfaos = await prisma.asiento.findMany({
    where: {
      descripcion: { contains: codigo },
      id: { notIn: asientoIds.length > 0 ? asientoIds : ["00000000-0000-0000-0000-000000000000"] },
    },
    select: { id: true, numero: true, estado: true, descripcion: true, fecha: true },
    orderBy: { numero: "asc" },
  });
  console.log(`\n— Asientos ÓRFÃOS (descripción menciona ${codigo} pero sin FK): ${orfaos.length}`);
  for (const o of orfaos) {
    console.log(`  #${o.numero} ${o.estado} "${o.descripcion}" (${o.id.slice(0, 8)}…)`);
  }

  const lineasOrfaos =
    orfaos.length > 0
      ? await prisma.lineaAsiento.count({ where: { asientoId: { in: orfaos.map((o) => o.id) } } })
      : 0;
  console.log(`  → ${lineasOrfaos} línea(s) en órfãos.`);

  return { emb, asientoIds, orfaoIds: orfaos.map((o) => o.id), movs };
}

async function main() {
  console.log(`Iniciando diagnóstico para ${TARGETS.join(", ")}`);
  for (const codigo of TARGETS) {
    await inspect(codigo);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
