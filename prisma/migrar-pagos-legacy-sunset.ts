// Migra los 2 pagos USD legacy a Sunset Tires Corp Limited (asientos pre-Fase 2)
// al formato nuevo de asiento ARS misto con diferencia cambiaria reconocida.
//
// Estado actual (post-PR #174):
//   Asiento USD de 2 líneas:
//     DEBE  2.1.8.10 SUNSET TIRES CORP   USD 25397.50 (ARS=USD×TC_pago)
//     HABER 1.1.2.xx BANCO USD           USD 25397.50
//   Asiento.moneda=USD, tipoCambio=TC_pago
//
//   Ambas líneas marcadas con monedaOrigen=USD (backfill anterior).
//   Saldo USD por línea: invariante ✓
//   PERO el saldo ARS de la cuenta proveedor queda con residual porque:
//     - Fatura HABER en cuenta: ARS = USD × TC_factura  (~36.5M)
//     - Pago    DEBE  en cuenta: ARS = USD × TC_pago    (~35.5M, TC menor)
//     - Spread $1.05M ARS = ganancia cambiaria NO reconocida
//
// Estado deseado (post-Fase 2):
//   Asiento ARS de 3 líneas:
//     DEBE  2.1.8.10 SUNSET TIRES CORP   ARS=USD×TC_factura  (monedaOrigen=USD)
//     HABER 1.1.2.xx BANCO USD           ARS=USD×TC_pago     (monedaOrigen=USD)
//     HABER 4.5.1.01 GANANCIA DIF CAMBIO ARS=spread          (sin monedaOrigen)
//
// Estrategia: anular asiento viejo + crear nuevo asiento misto reproduciendo
// el mismo MovimientoTesoreria.id. Para no perder auditoría, gravamos en
// descripcion del asiento nuevo un link al asiento viejo anulado.
//
// Uso:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/migrar-pagos-legacy-sunset.ts [--dry]

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Moneda } from "../src/generated/prisma/client";
import { Decimal } from "decimal.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const DRY = process.argv.includes("--dry");

function fmt(d: Decimal | string | number): string {
  return new Decimal(d.toString()).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function getCuenta(codigo: string) {
  const c = await prisma.cuentaContable.findUnique({ where: { codigo } });
  if (!c) throw new Error(`Cuenta ${codigo} no encontrada`);
  return c;
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.match(/@([^/:]+)/)?.[1] ?? "?";
  console.log(`→ DB host: ${dbHost}`);
  console.log(`→ Mode: ${DRY ? "DRY RUN" : "APPLY"}\n`);

  const sunsetCuenta = await getCuenta("2.1.8.10");
  const cuentaGanancia = await getCuenta("4.5.1.01");

  // Localiza los pagos USD legacy: MovimientoTesoreria PAGO USD a Sunset Tires Corp.
  const movs = await prisma.movimientoTesoreria.findMany({
    where: {
      tipo: "PAGO",
      moneda: Moneda.USD,
      cuentaContableId: sunsetCuenta.id,
      asientoId: { not: null },
    },
    include: {
      cuentaBancaria: { select: { id: true, banco: true, cuentaContableId: true } },
      asiento: {
        include: {
          lineas: { include: { cuenta: { select: { codigo: true } } } },
        },
      },
    },
  });

  console.log(`Encontrados ${movs.length} pagos USD legacy a la cuenta Sunset Tires.\n`);

  for (const m of movs) {
    if (!m.asiento) continue;
    const asientoViejo = m.asiento;

    // Identifica las líneas y verifica que sea el formato viejo (asiento.moneda=USD)
    if (asientoViejo.moneda !== Moneda.USD) {
      console.log(
        `[skip] Movimiento ${m.id.slice(0, 8)}: asiento ${asientoViejo.numero} ya es ARS (no es legacy)`,
      );
      continue;
    }

    const lineaProveedor = asientoViejo.lineas.find((l) => l.cuentaId === sunsetCuenta.id);
    const lineaBanco = asientoViejo.lineas.find(
      (l) => l.cuentaId === m.cuentaBancaria.cuentaContableId,
    );
    if (!lineaProveedor || !lineaBanco) {
      console.log(`[skip] Movimiento ${m.id.slice(0, 8)}: estructura de asiento inesperada`);
      continue;
    }

    const usdPago = new Decimal(m.monto.toString());
    const tcPago = new Decimal(m.tipoCambio.toString());

    // Reconstruir TC_factura ponderado FIFO: sumamos las facturas pendientes
    // *que cubrió este pago* (saldo HABER USD pendiente en orden FIFO).
    // Para los 2 pagos legacy de Sunset Tires, sabemos que cada pago cancela
    // exactamente una factura USD del mismo monto (matching por descripción
    // referencia al embarque AR-250827-015CN/016CN). Buscamos esa factura
    // específica via descripción de la línea HABER en el asiento de FOB.
    const refEmbarque = (m.descripcion ?? "").match(/AR-\d{6}-\d{3}[A-Z]{2}/)?.[0];
    if (!refEmbarque) {
      console.log(
        `[skip] Movimiento ${m.id.slice(0, 8)}: no encontré referencia de embarque en descripción "${m.descripcion}"`,
      );
      continue;
    }

    // Buscar la línea de factura HABER USD que mencione ese embarque
    const lineaFactura = await prisma.lineaAsiento.findFirst({
      where: {
        cuentaId: sunsetCuenta.id,
        monedaOrigen: Moneda.USD,
        haber: { gt: 0 },
        asiento: { estado: "CONTABILIZADO" },
        descripcion: { contains: refEmbarque },
      },
      include: { asiento: { select: { numero: true, fecha: true } } },
    });

    if (!lineaFactura?.tipoCambioOrigen) {
      console.log(
        `[skip] Movimiento ${m.id.slice(0, 8)}: no encontré factura USD para ${refEmbarque}`,
      );
      continue;
    }

    const tcFactura = new Decimal(lineaFactura.tipoCambioOrigen.toString());
    const arsFactura = usdPago.times(tcFactura).toDecimalPlaces(2);
    const arsPago = usdPago.times(tcPago).toDecimalPlaces(2);
    const spread = arsFactura.minus(arsPago);

    console.log(`▸ Movimiento ${m.id.slice(0, 8)} (asiento legacy #${asientoViejo.numero})`);
    console.log(`   Embarque ref: ${refEmbarque} (factura asiento #${lineaFactura.asiento.numero})`);
    console.log(`   USD pago: ${fmt(usdPago)}`);
    console.log(`   TC factura: ${tcFactura.toFixed(4)} | TC pago: ${tcPago.toFixed(4)}`);
    console.log(`   ARS factura: ${fmt(arsFactura)} | ARS pago: ${fmt(arsPago)}`);
    console.log(`   Spread: ${fmt(spread.abs())} (${spread.gt(0) ? "ganancia" : "pérdida"})`);

    if (DRY) {
      console.log(`   [DRY] no aplicado.\n`);
      continue;
    }

    // Aplicar: dentro de transacción
    await prisma.$transaction(async (tx) => {
      // 1) Anular asiento viejo (mantiene auditoría — anulado, no eliminado)
      await tx.asiento.update({
        where: { id: asientoViejo.id },
        data: {
          estado: "ANULADO",
          descripcion: `${asientoViejo.descripcion} [MIGRADO a nuevo asiento ARS misto en ${new Date().toISOString().slice(0, 10)}]`,
        },
      });
      // 2) Desligar el movimiento del asiento viejo
      await tx.movimientoTesoreria.update({
        where: { id: m.id },
        data: { asientoId: null },
      });

      // 3) Buscar período del movimiento
      const periodo = await tx.periodoContable.findFirst({
        where: { fechaInicio: { lte: m.fecha }, fechaFin: { gte: m.fecha } },
      });
      if (!periodo) throw new Error(`Sin período para ${m.fecha.toISOString()}`);

      // 4) Próximo número
      const last = await tx.asiento.findFirst({
        where: { periodoId: periodo.id },
        orderBy: { numero: "desc" },
        select: { numero: true },
      });
      const numero = (last?.numero ?? 0) + 1;

      // 5) Crear asiento nuevo ARS misto
      type LineaMig = {
        cuentaId: number;
        debe: string;
        haber: string;
        descripcion: string;
        monedaOrigen: Moneda | null;
        montoOrigen: string | null;
        tipoCambioOrigen: string | null;
      };
      const lineas: LineaMig[] = [
        {
          cuentaId: sunsetCuenta.id,
          debe: arsFactura.toFixed(2),
          haber: "0",
          descripcion: `Pago factura USD ${usdPago.toFixed(2)} ${refEmbarque} (cancela pasivo al TC factura, migrado de asiento #${asientoViejo.numero})`,
          monedaOrigen: Moneda.USD,
          montoOrigen: usdPago.toFixed(2),
          tipoCambioOrigen: tcFactura.toFixed(6),
        },
        {
          cuentaId: m.cuentaBancaria.cuentaContableId,
          debe: "0",
          haber: arsPago.toFixed(2),
          descripcion: `Salida banco USD ${usdPago.toFixed(2)} × TC ${tcPago.toFixed(4)}`,
          monedaOrigen: Moneda.USD,
          montoOrigen: usdPago.toFixed(2),
          tipoCambioOrigen: tcPago.toFixed(6),
        },
      ];

      if (!spread.abs().lte(0.005)) {
        if (spread.gt(0)) {
          lineas.push({
            cuentaId: cuentaGanancia.id,
            debe: "0",
            haber: spread.toFixed(2),
            descripcion: `Ganancia diferencia cambiaria (TC fact ${tcFactura.toFixed(4)} → TC pago ${tcPago.toFixed(4)})`,
            monedaOrigen: null,
            montoOrigen: null,
            tipoCambioOrigen: null,
          });
        } else {
          // pérdida — 5.5.3.01 sería el caso simétrico, pero los 2 pagos
          // legacy son ambos ganancias (TC pago < TC factura), no aplica acá
          throw new Error(`Pérdida inesperada en migración legacy — revisar`);
        }
      }

      const nuevoAsientoId = `mig-${m.id}`;
      await tx.asiento.create({
        data: {
          id: nuevoAsientoId,
          numero,
          fecha: m.fecha,
          descripcion: `PAGO USD ${usdPago.toFixed(2)} ${refEmbarque} (migrado de asiento #${asientoViejo.numero})`,
          estado: "CONTABILIZADO",
          origen: "TESORERIA",
          moneda: Moneda.ARS,
          tipoCambio: "1",
          totalDebe: arsFactura.toFixed(2),
          totalHaber: arsFactura.toFixed(2),
          periodoId: periodo.id,
          lineas: {
            create: lineas.map((l) => ({
              cuentaId: l.cuentaId,
              debe: l.debe,
              haber: l.haber,
              descripcion: l.descripcion,
              monedaOrigen: l.monedaOrigen,
              montoOrigen: l.montoOrigen,
              tipoCambioOrigen: l.tipoCambioOrigen,
            })),
          },
        },
      });

      // 6) Vincular movimiento al nuevo asiento
      await tx.movimientoTesoreria.update({
        where: { id: m.id },
        data: { asientoId: nuevoAsientoId },
      });

      console.log(`   ✔ Migrado a asiento nuevo #${numero}\n`);
    });
  }

  if (DRY) {
    console.log("\nDRY RUN — ninguna escritura. Quitá --dry para aplicar.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
