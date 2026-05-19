/**
 * Backfill de las 3 tablas `AplicacionPago{EmbarqueCosto|Compra|Gasto}`
 * para pagos históricos (registrados antes de la Fase 2). Replica el
 * algoritmo de Layer 1 (match por número de factura en la descripción
 * de la línea DEBE) y graba rows de FK estructural.
 *
 * Layer 2 (embarque code) y Layer 4 (FIFO sin id) se quedan como
 * fallback en runtime; el backfill solo cubre matches inequívocos.
 *
 * Idempotente: usa unique constraint `(lineaAsientoId, sourceId)`
 * para skipear rows ya existentes (creadas via Fase 2 actions o
 * runs anteriores del backfill).
 *
 * Uso:
 *   pnpm tsx prisma/backfill-aplicacion-pago.ts            # dry-run
 *   pnpm tsx prisma/backfill-aplicacion-pago.ts --apply    # aplica
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import {
  AsientoEstado,
  CompraEstado,
  EmbarqueEstado,
  GastoEstado,
  PrismaClient,
} from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const APPLY = process.argv.includes("--apply");

// Tokens genéricos que NÃO devem disparar match (espelha cuentas-a-pagar.ts).
const TOKENS_GENERICOS = new Set(["Factura", "factura", "Pago", "pago"]);

function tokenize(descripcion: string | null | undefined): Set<string> {
  if (!descripcion) return new Set();
  // Separadores: espaços, em-dash, vírgula, ponto-vírgula, parênteses.
  return new Set(descripcion.split(/[\s—,;()]+/).filter((t) => t.length > 0));
}

type FacturaSource =
  | { tipo: "embarqueCosto"; id: number; numero: string; fecha: Date | null }
  | { tipo: "compra"; id: string; numero: string; fecha: Date | null }
  | { tipo: "gasto"; id: string; numero: string; fecha: Date | null };

async function main() {
  console.log(`\n=== Backfill AplicacionPago* (Layer 1 token match) ===`);
  console.log(`Modo: ${APPLY ? "APPLY (cambios reales)" : "DRY-RUN (sin cambios)"}\n`);

  const proveedores = await prisma.proveedor.findMany({
    where: { cuentaContableId: { not: null } },
    select: { id: true, nombre: true, cuentaContableId: true },
  });

  const [costos, compras, gastos] = await Promise.all([
    prisma.embarqueCosto.findMany({
      where: { embarque: { estado: EmbarqueEstado.CERRADO }, facturaNumero: { not: null } },
      select: { id: true, facturaNumero: true, fechaFactura: true, proveedorId: true },
    }),
    prisma.compra.findMany({
      where: { estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] } },
      select: { id: true, numero: true, fecha: true, proveedorId: true },
    }),
    prisma.gasto.findMany({
      where: { estado: GastoEstado.CONTABILIZADO },
      select: {
        id: true,
        numero: true,
        facturaNumero: true,
        fecha: true,
        proveedorId: true,
      },
    }),
  ]);

  // Index facturas por proveedorId
  const facturasPorProveedor = new Map<string, FacturaSource[]>();
  for (const c of costos) {
    if (!c.facturaNumero) continue;
    const arr = facturasPorProveedor.get(c.proveedorId) ?? [];
    arr.push({ tipo: "embarqueCosto", id: c.id, numero: c.facturaNumero, fecha: c.fechaFactura });
    facturasPorProveedor.set(c.proveedorId, arr);
  }
  for (const c of compras) {
    const arr = facturasPorProveedor.get(c.proveedorId) ?? [];
    arr.push({ tipo: "compra", id: c.id, numero: c.numero, fecha: c.fecha });
    facturasPorProveedor.set(c.proveedorId, arr);
  }
  for (const g of gastos) {
    const numero = g.facturaNumero ?? g.numero;
    const arr = facturasPorProveedor.get(g.proveedorId) ?? [];
    arr.push({ tipo: "gasto", id: g.id, numero, fecha: g.fecha });
    facturasPorProveedor.set(g.proveedorId, arr);
  }

  let totalProveedores = 0;
  let totalRowsACrear = 0;
  let totalRowsCreadas = 0;
  let totalSkippedExistentes = 0;
  let totalAmbiguos = 0;
  let totalLineasSinMatch = 0;

  for (const p of proveedores) {
    if (!p.cuentaContableId) continue;
    const facturas = facturasPorProveedor.get(p.id) ?? [];
    if (facturas.length === 0) continue;
    totalProveedores++;

    // Levantar todas as líneas DEBE da cuenta do proveedor, asiento CONTABILIZADO.
    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        cuentaId: p.cuentaContableId,
        debe: { gt: 0 },
        asiento: { estado: AsientoEstado.CONTABILIZADO },
      },
      select: {
        id: true,
        debe: true,
        haber: true,
        descripcion: true,
        asiento: { select: { numero: true } },
      },
    });
    if (lineas.length === 0) continue;

    let proveedorRowsACrear = 0;
    let proveedorAmbiguos = 0;
    let proveedorSinMatch = 0;

    for (const l of lineas) {
      const debe = new Decimal(l.debe.toString());
      const haber = new Decimal(l.haber.toString());
      const neto = debe.minus(haber);
      if (neto.lte(0.005)) continue;

      const tokens = tokenize(l.descripcion);
      // Tentar match com cada factura: todos tokens do numero devem estar
      // presentes na descripcion da linha.
      const matches = facturas.filter((f) => {
        const numeroTokens = f.numero.split(/[\s—,;]+/).filter((t) => t.length > 0);
        if (numeroTokens.length === 0) return false;
        const especificos = numeroTokens.filter((t) => !TOKENS_GENERICOS.has(t));
        if (especificos.length === 0) return false;
        return numeroTokens.every((t) => tokens.has(t));
      });

      if (matches.length === 0) {
        proveedorSinMatch++;
        totalLineasSinMatch++;
        continue;
      }

      if (matches.length > 1) {
        // Múltiplos matches — Layer 1 puro não consegue decidir. Skip.
        // (Layer 2/4 em runtime cobre estes casos via embarque code / FIFO.)
        proveedorAmbiguos++;
        totalAmbiguos++;
        continue;
      }

      // Match único — verificar se row já existe e gravar.
      const m = matches[0]!;
      const montoArs = neto.toFixed(2);

      // Check existencia
      let yaExiste = false;
      if (m.tipo === "embarqueCosto") {
        yaExiste = !!(await prisma.aplicacionPagoEmbarqueCosto.findFirst({
          where: { lineaAsientoId: l.id, embarqueCostoId: m.id },
        }));
      } else if (m.tipo === "compra") {
        yaExiste = !!(await prisma.aplicacionPagoCompra.findFirst({
          where: { lineaAsientoId: l.id, compraId: m.id },
        }));
      } else {
        yaExiste = !!(await prisma.aplicacionPagoGasto.findFirst({
          where: { lineaAsientoId: l.id, gastoId: m.id },
        }));
      }

      if (yaExiste) {
        totalSkippedExistentes++;
        continue;
      }

      proveedorRowsACrear++;
      totalRowsACrear++;

      if (!APPLY) continue;

      try {
        if (m.tipo === "embarqueCosto") {
          await prisma.aplicacionPagoEmbarqueCosto.create({
            data: { lineaAsientoId: l.id, embarqueCostoId: m.id, montoArs },
          });
        } else if (m.tipo === "compra") {
          await prisma.aplicacionPagoCompra.create({
            data: { lineaAsientoId: l.id, compraId: m.id, montoArs },
          });
        } else {
          await prisma.aplicacionPagoGasto.create({
            data: { lineaAsientoId: l.id, gastoId: m.id, montoArs },
          });
        }
        totalRowsCreadas++;
      } catch (err) {
        console.error(
          `  ✗ Error al crear AplicacionPago para línea #${l.asiento.numero}/${l.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (proveedorRowsACrear > 0 || proveedorAmbiguos > 0 || proveedorSinMatch > 0) {
      console.log(
        `${p.nombre.padEnd(40)} | ${proveedorRowsACrear} a crear | ${proveedorAmbiguos} ambíguos | ${proveedorSinMatch} sin match`,
      );
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Proveedores con facturas: ${totalProveedores}`);
  console.log(`Rows a crear (Layer 1 match único): ${totalRowsACrear}`);
  console.log(`Rows ya existentes (skipped): ${totalSkippedExistentes}`);
  console.log(`Líneas con match ambíguo (>=2 facturas): ${totalAmbiguos}`);
  console.log(`Líneas sin ningún match: ${totalLineasSinMatch}`);
  if (APPLY) {
    console.log(`Rows efectivamente creadas: ${totalRowsCreadas}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
