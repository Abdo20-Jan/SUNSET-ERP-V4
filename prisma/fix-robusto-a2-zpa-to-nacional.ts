/**
 * Fix puntual: el embarque AR-251223-036CN fue contabilizado vía cierre
 * monolítico legacy con `depositoDestinoId = TP-ZPA` (debería ser NACIONAL).
 * Resultado: 100 unidades de 295 ROBUSTO A2 quedaron en SPD ZPA en lugar
 * de NACIONAL, aunque contablemente la mercadería ya está en 1.1.5.01.
 *
 * Este caso es distinto al tratado por `fix-embarque-ar-251223-036cn.ts`
 * (que limpia un asientoZP anulado huérfano). Aquí movemos físicamente
 * el stock ZPA → NACIONAL mediante una Transferencia, replicando el
 * efecto de la Fase C que no existía cuando el despacho fue contabilizado.
 *
 * Reflexión contable: no se toca ningún asiento. La cuenta 1.1.5.01
 * Mercaderías ya tiene el saldo correcto (el cierre monolítico debitó
 * ahí). La Transferencia es solo física en los SPDs — no genera asiento
 * (es lo esperado en el modelo actual: transferências entre depósitos
 * NACIONAL/ZPA del mismo proveedor no cruzan cuenta contable).
 *
 * Uso:
 *   pnpm tsx prisma/fix-robusto-a2-zpa-to-nacional.ts            # dry-run
 *   pnpm tsx prisma/fix-robusto-a2-zpa-to-nacional.ts --apply    # aplica
 */
import { config as dotenvConfig } from "dotenv";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  MovimientoStockTipo,
  Prisma,
  PrismaClient,
  TipoDeposito,
  TransferenciaEstado,
} from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const APPLY = process.argv.includes("--apply");
const PRODUCTO_CODIGO = "295 ROBUSTO A2";
const EMBARQUE_CODIGO = "AR-251223-036CN";
const CANTIDAD_ESPERADA = 100;
const COSTO_ESPERADO = "18256.60";

async function main() {
  console.log(`Buscando producto ${PRODUCTO_CODIGO}…`);
  const producto = await prisma.producto.findFirst({
    where: { codigo: PRODUCTO_CODIGO },
    select: { id: true, codigo: true, nombre: true },
  });
  if (!producto) {
    console.error(`Producto "${PRODUCTO_CODIGO}" no encontrado.`);
    process.exit(1);
  }
  console.log(`  → ${producto.id} ${producto.nombre}`);

  console.log(`\nBuscando depósitos ZPA y NACIONAL del proveedor TP…`);
  const depositos = await prisma.deposito.findMany({
    where: { activo: true, nombre: { contains: "TP" } },
    select: { id: true, nombre: true, tipo: true },
    orderBy: { nombre: "asc" },
  });
  const zpa = depositos.find((d) => d.tipo === TipoDeposito.ZONA_PRIMARIA);
  const nacional = depositos.find((d) => d.tipo === TipoDeposito.NACIONAL);
  if (!zpa || !nacional) {
    console.error(
      `Depósitos no encontrados. Esperados: 1 NACIONAL + 1 ZPA con "TP" en nombre. Encontrados: ${depositos
        .map((d) => `${d.nombre}(${d.tipo})`)
        .join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`  ZPA      : ${zpa.id} ${zpa.nombre}`);
  console.log(`  NACIONAL : ${nacional.id} ${nacional.nombre}`);

  console.log(`\nVerificando SPD actual…`);
  const spdZpa = await prisma.stockPorDeposito.findUnique({
    where: { productoId_depositoId: { productoId: producto.id, depositoId: zpa.id } },
    select: { cantidadFisica: true, cantidadReservada: true, costoPromedio: true },
  });
  const spdNacional = await prisma.stockPorDeposito.findUnique({
    where: { productoId_depositoId: { productoId: producto.id, depositoId: nacional.id } },
    select: { cantidadFisica: true, cantidadReservada: true, costoPromedio: true },
  });
  console.log(
    `  ZPA      : fisica=${spdZpa?.cantidadFisica ?? 0} reservada=${spdZpa?.cantidadReservada ?? 0} costo=${spdZpa?.costoPromedio ?? "—"}`,
  );
  console.log(
    `  NACIONAL : fisica=${spdNacional?.cantidadFisica ?? 0} reservada=${spdNacional?.cantidadReservada ?? 0} costo=${spdNacional?.costoPromedio ?? "—"}`,
  );

  if (!spdZpa || spdZpa.cantidadFisica !== CANTIDAD_ESPERADA) {
    console.error(
      `\nValidación fallida: esperaba ${CANTIDAD_ESPERADA} unidades en ZPA, encontré ${spdZpa?.cantidadFisica ?? 0}. Abortando.`,
    );
    process.exit(1);
  }
  if (spdZpa.cantidadReservada > 0) {
    console.error(
      `\nValidación fallida: SPD ZPA tiene ${spdZpa.cantidadReservada} unidades reservadas. Liberar reservas antes del fix. Abortando.`,
    );
    process.exit(1);
  }

  // Verificar que no haya transferencia previa cubriendo este caso (idempotencia)
  const movimientosTransfPrevios = await prisma.movimientoStock.findMany({
    where: {
      productoId: producto.id,
      depositoId: { in: [zpa.id, nacional.id] },
      tipo: MovimientoStockTipo.TRANSFERENCIA,
    },
    select: { id: true, fecha: true, cantidad: true, depositoId: true, transferenciaId: true },
  });
  if (movimientosTransfPrevios.length > 0) {
    console.log(
      `\n⚠️  Ya existen ${movimientosTransfPrevios.length} MovimientoStock TRANSFERENCIA para este producto entre ZPA/NACIONAL:`,
    );
    for (const m of movimientosTransfPrevios) {
      console.log(
        `    ${m.fecha.toISOString().slice(0, 10)} qty=${m.cantidad} dep=${m.depositoId.slice(0, 8)} transf=${m.transferenciaId?.slice(0, 8) ?? "-"}`,
      );
    }
    console.log(`    Si la corrección ya se aplicó, abortar manualmente.`);
  }

  console.log(`\n=== Plan ===`);
  console.log(
    `Crear Transferencia(producto=${PRODUCTO_CODIGO}, origen=ZPA, destino=NACIONAL, cant=${CANTIDAD_ESPERADA}, costo=${COSTO_ESPERADO})`,
  );
  console.log(`  • SPD ZPA      : ${CANTIDAD_ESPERADA} → 0`);
  console.log(
    `  • SPD NACIONAL : ${spdNacional?.cantidadFisica ?? 0} → ${(spdNacional?.cantidadFisica ?? 0) + CANTIDAD_ESPERADA}`,
  );
  console.log(`  • 2 MovimientoStock TRANSFERENCIA (egreso ZPA + ingreso NACIONAL)`);
  console.log(
    `  • No genera asiento contable (contabilidad ya está correcta vía cierre monolítico)`,
  );

  if (!APPLY) {
    console.log(`\nDry-run. Re-ejecutar con --apply para aplicar.`);
    return;
  }

  console.log(`\n=== Aplicando ===`);

  const fecha = new Date();
  const numero = `T-FIX-${EMBARQUE_CODIGO}-${Date.now()}`;
  const transferenciaId = randomUUID();
  const costoUnitario = new Prisma.Decimal(COSTO_ESPERADO);

  await prisma.$transaction(async (tx) => {
    // 1. Crear la Transferencia
    await tx.transferencia.create({
      data: {
        id: transferenciaId,
        numero,
        productoId: producto.id,
        depositoOrigenId: zpa.id,
        depositoDestinoId: nacional.id,
        cantidad: CANTIDAD_ESPERADA,
        fecha,
        estado: TransferenciaEstado.CONFIRMADA,
        observacion: `Fix manual: stock corregido tras cierre monolítico legacy del embarque ${EMBARQUE_CODIGO} que apuntaba a depósito ZPA. Reproduce el efecto Fase C ausente.`,
      },
    });

    // 2. Decrementar SPD origen (ZPA)
    await tx.stockPorDeposito.update({
      where: {
        productoId_depositoId: { productoId: producto.id, depositoId: zpa.id },
      },
      data: {
        cantidadFisica: { decrement: CANTIDAD_ESPERADA },
        ultimoMovimiento: fecha,
      },
    });

    // 3. Incrementar SPD destino (NACIONAL). Si ya existe, recalcula promedio
    //    ponderado. Si no existe, crea con costoPromedio = COSTO_ESPERADO.
    const existingNacional = await tx.stockPorDeposito.findUnique({
      where: {
        productoId_depositoId: { productoId: producto.id, depositoId: nacional.id },
      },
      select: { cantidadFisica: true, costoPromedio: true },
    });
    if (existingNacional && existingNacional.cantidadFisica > 0) {
      // Promedio ponderado
      const cantActual = new Prisma.Decimal(existingNacional.cantidadFisica);
      const costoActual = new Prisma.Decimal(existingNacional.costoPromedio);
      const cantNueva = new Prisma.Decimal(CANTIDAD_ESPERADA);
      const total = cantActual.plus(cantNueva);
      const nuevoCosto = cantActual
        .times(costoActual)
        .plus(cantNueva.times(costoUnitario))
        .div(total)
        .toDecimalPlaces(2);
      await tx.stockPorDeposito.update({
        where: {
          productoId_depositoId: { productoId: producto.id, depositoId: nacional.id },
        },
        data: {
          cantidadFisica: { increment: CANTIDAD_ESPERADA },
          costoPromedio: nuevoCosto,
          ultimoMovimiento: fecha,
        },
      });
    } else if (existingNacional) {
      // Existe row pero con cantidad 0 — usar nuevo costo
      await tx.stockPorDeposito.update({
        where: {
          productoId_depositoId: { productoId: producto.id, depositoId: nacional.id },
        },
        data: {
          cantidadFisica: CANTIDAD_ESPERADA,
          costoPromedio: costoUnitario,
          ultimoMovimiento: fecha,
        },
      });
    } else {
      await tx.stockPorDeposito.create({
        data: {
          productoId: producto.id,
          depositoId: nacional.id,
          cantidadFisica: CANTIDAD_ESPERADA,
          cantidadReservada: 0,
          costoPromedio: costoUnitario,
          ultimoMovimiento: fecha,
        },
      });
    }

    // 4. Crear 2 MovimientoStock TRANSFERENCIA
    await tx.movimientoStock.createMany({
      data: [
        {
          productoId: producto.id,
          depositoId: zpa.id,
          tipo: MovimientoStockTipo.TRANSFERENCIA,
          cantidad: -CANTIDAD_ESPERADA,
          costoUnitario,
          fecha,
          transferenciaId,
        },
        {
          productoId: producto.id,
          depositoId: nacional.id,
          tipo: MovimientoStockTipo.TRANSFERENCIA,
          cantidad: CANTIDAD_ESPERADA,
          costoUnitario,
          fecha,
          transferenciaId,
        },
      ],
    });
  });

  console.log(`✓ Transferencia ${numero} aplicada.`);

  // Verificación post-fix
  const spdZpaAfter = await prisma.stockPorDeposito.findUnique({
    where: { productoId_depositoId: { productoId: producto.id, depositoId: zpa.id } },
    select: { cantidadFisica: true, costoPromedio: true },
  });
  const spdNacionalAfter = await prisma.stockPorDeposito.findUnique({
    where: { productoId_depositoId: { productoId: producto.id, depositoId: nacional.id } },
    select: { cantidadFisica: true, costoPromedio: true },
  });
  console.log(`\nSPD después del fix:`);
  console.log(
    `  ZPA      : fisica=${spdZpaAfter?.cantidadFisica} costo=${spdZpaAfter?.costoPromedio}`,
  );
  console.log(
    `  NACIONAL : fisica=${spdNacionalAfter?.cantidadFisica} costo=${spdNacionalAfter?.costoPromedio}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
