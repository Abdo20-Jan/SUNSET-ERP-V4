/**
 * W3.3 — Backfill StockPorDeposito desde Producto.stockActual.
 *
 * Pre-requisitos:
 *  1. Schema de W3.0 aplicado (`pnpm db:push`).
 *  2. Depósitos NACIONAL + ZONA PRIMARIA ADUANEIRA (o nomenclatura propia)
 *     ya cargados en la base.
 *  3. Tabla StockPorDeposito vacía (el script aborta si encuentra rows
 *     existentes — re-ejecutar requiere `DELETE FROM "StockPorDeposito"`).
 *
 * Uso:
 *
 *   # Modo simple — todo el stock de cada producto va a un único depósito.
 *   pnpm db:backfill-stock --all-to <depositoId>
 *
 *   # Modo CSV — distribución manual entre N depósitos.
 *   # CSV format (con header):
 *   #   productoId,depositoId,cantidad,costoPromedio
 *   pnpm db:backfill-stock --csv path/to/repartition.csv
 *
 *   # Dry-run — no escribe en la base.
 *   pnpm db:backfill-stock --csv path/to/repartition.csv --dry-run
 *
 * Verificación post-backfill: el script invoca el validador automáticamente.
 * Si encuentra divergencias, hace rollback de toda la transacción.
 */

import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";

type CliOpts = {
  mode: "all-to" | "csv";
  depositoId?: string;
  csvPath?: string;
  dryRun: boolean;
};

type CsvRow = {
  productoId: string;
  depositoId: string;
  cantidad: number;
  costoPromedio: string;
};

type ArgKind = "all-to" | "csv" | "dry-run" | "help";

type ProductoSnapshot = {
  id: string;
  codigo: string;
  stockActual: number;
  costoPromedio: Prisma.Decimal;
};

type InsertPlan = {
  productoId: string;
  depositoId: string;
  cantidadFisica: number;
  costoPromedio: Prisma.Decimal;
};

// ---------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------

function classifyArg(
  arg: string,
  next: string | undefined,
  opts: CliOpts,
): ArgKind {
  if (arg === "--all-to") {
    opts.depositoId = next;
    return "all-to";
  }
  if (arg === "--csv") {
    opts.csvPath = next;
    return "csv";
  }
  if (arg === "--dry-run") {
    opts.dryRun = true;
    return "dry-run";
  }
  if (arg === "--help" || arg === "-h") {
    return "help";
  }
  throw new Error(`Argumento desconocido: ${arg}`);
}

function validateMode(
  mode: "all-to" | "csv" | null,
  opts: CliOpts,
): "all-to" | "csv" {
  if (!mode) {
    printHelp();
    throw new Error("Falta especificar --all-to <depositoId> o --csv <path>.");
  }
  if (mode === "all-to" && !opts.depositoId) {
    throw new Error("--all-to requiere un depositoId.");
  }
  if (mode === "csv" && !opts.csvPath) {
    throw new Error("--csv requiere un path.");
  }
  return mode;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { mode: "all-to", dryRun: false };
  let mode: "all-to" | "csv" | null = null;

  for (let i = 0; i < argv.length; i++) {
    const kind = classifyArg(argv[i], argv[i + 1], opts);
    if (kind === "help") {
      printHelp();
      process.exit(0);
    }
    if (kind === "all-to" || kind === "csv") {
      mode = kind;
      i++;
    }
  }

  opts.mode = validateMode(mode, opts);
  return opts;
}

function printHelp(): void {
  console.log(`
Backfill StockPorDeposito desde Producto.stockActual.

Modos:
  --all-to <depositoId>    Asignar todo el stock de cada producto al depósito dado.
  --csv <path>             Distribución manual via CSV.
  --dry-run                Simular sin escribir.
  -h, --help               Mostrar esta ayuda.
`);
}

// ---------------------------------------------------------------
// CSV parsing y validación
// ---------------------------------------------------------------

function parseCsv(path: string): CsvRow[] {
  const absolute = resolve(process.cwd(), path);
  const raw = readFileSync(absolute, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error(`CSV vacío: ${absolute}`);
  }
  validateCsvHeader(lines[0]);
  return lines.slice(1).map((line, i) => parseCsvLine(line, i + 2));
}

function validateCsvHeader(headerLine: string): void {
  const header = headerLine.split(",").map((c) => c.trim());
  const expected = ["productoId", "depositoId", "cantidad", "costoPromedio"];
  const matches =
    header.length === expected.length &&
    expected.every((col, i) => header[i] === col);
  if (!matches) {
    throw new Error(
      `CSV header inesperado. Esperado: ${expected.join(",")}; encontrado: ${header.join(",")}`,
    );
  }
}

function parseCsvLine(line: string, lineNumber: number): CsvRow {
  const cols = line.split(",").map((c) => c.trim());
  if (cols.length !== 4) {
    throw new Error(
      `CSV línea ${lineNumber}: 4 columnas esperadas, encontradas ${cols.length}`,
    );
  }
  const cantidad = Number.parseInt(cols[2], 10);
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new Error(`CSV línea ${lineNumber}: cantidad inválida "${cols[2]}"`);
  }
  return {
    productoId: cols[0],
    depositoId: cols[1],
    cantidad,
    costoPromedio: cols[3],
  };
}

async function validateCsvIds(
  prisma: PrismaClient,
  rows: CsvRow[],
): Promise<void> {
  const depIds = Array.from(new Set(rows.map((r) => r.depositoId)));
  const prodIds = Array.from(new Set(rows.map((r) => r.productoId)));
  const [depsExist, prodsExist] = await Promise.all([
    prisma.deposito.findMany({
      where: { id: { in: depIds } },
      select: { id: true, nombre: true, activo: true },
    }),
    prisma.producto.findMany({
      where: { id: { in: prodIds } },
      select: { id: true },
    }),
  ]);
  const depsById = new Map(depsExist.map((d) => [d.id, d]));
  const prodIdsExisting = new Set(prodsExist.map((p) => p.id));
  for (const r of rows) {
    const dep = depsById.get(r.depositoId);
    if (!dep) {
      throw new Error(`CSV: depósito ${r.depositoId} no existe.`);
    }
    if (!dep.activo) {
      throw new Error(`CSV: depósito "${dep.nombre}" está inactivo.`);
    }
    if (!prodIdsExisting.has(r.productoId)) {
      throw new Error(`CSV: producto ${r.productoId} no existe.`);
    }
  }
}

function validateCsvSums(
  productos: ProductoSnapshot[],
  rows: CsvRow[],
): void {
  const sumByProducto = new Map<string, number>();
  for (const r of rows) {
    sumByProducto.set(
      r.productoId,
      (sumByProducto.get(r.productoId) ?? 0) + r.cantidad,
    );
  }
  for (const p of productos) {
    const sum = sumByProducto.get(p.id) ?? 0;
    if (sum !== p.stockActual) {
      throw new Error(
        `CSV: producto ${p.codigo} (${p.id}) suma ${sum} pero stockActual=${p.stockActual}.`,
      );
    }
  }
}

function mergeCsvRows(rows: CsvRow[]): InsertPlan[] {
  const merged = new Map<string, InsertPlan>();
  for (const r of rows) {
    const key = `${r.productoId}|${r.depositoId}`;
    const cur = merged.get(key);
    if (cur) {
      cur.cantidadFisica += r.cantidad;
    } else {
      merged.set(key, {
        productoId: r.productoId,
        depositoId: r.depositoId,
        cantidadFisica: r.cantidad,
        costoPromedio: new Prisma.Decimal(r.costoPromedio),
      });
    }
  }
  return Array.from(merged.values());
}

// ---------------------------------------------------------------
// Construcción del plan de inserts
// ---------------------------------------------------------------

async function buildPlanAllTo(
  prisma: PrismaClient,
  productos: ProductoSnapshot[],
  opts: CliOpts,
): Promise<InsertPlan[]> {
  const depositoId = opts.depositoId;
  if (!depositoId) {
    throw new Error("--all-to requiere un depositoId.");
  }
  const dep = await prisma.deposito.findUnique({
    where: { id: depositoId },
    select: { id: true, nombre: true, activo: true },
  });
  if (!dep) {
    throw new Error(`Depósito ${depositoId} no existe.`);
  }
  if (!dep.activo) {
    throw new Error(`Depósito "${dep.nombre}" está inactivo.`);
  }
  console.log(`  → todo el stock va a "${dep.nombre}".`);
  return productos.map((p) => ({
    productoId: p.id,
    depositoId: dep.id,
    cantidadFisica: p.stockActual,
    costoPromedio: new Prisma.Decimal(p.costoPromedio),
  }));
}

async function buildPlanFromCsv(
  prisma: PrismaClient,
  productos: ProductoSnapshot[],
  opts: CliOpts,
): Promise<InsertPlan[]> {
  const csvPath = opts.csvPath;
  if (!csvPath) {
    throw new Error("--csv requiere un path.");
  }
  const rows = parseCsv(csvPath);
  console.log(`✓ CSV leído: ${rows.length} filas.`);
  await validateCsvIds(prisma, rows);
  validateCsvSums(productos, rows);
  return mergeCsvRows(rows);
}

// ---------------------------------------------------------------
// Aplicación del plan
// ---------------------------------------------------------------

function printDryRun(plan: InsertPlan[]): void {
  console.log("\n[DRY-RUN] No se escribirá nada. Primeras 5 filas del plan:");
  for (const row of plan.slice(0, 5)) {
    console.log(
      `  producto=${row.productoId} depósito=${row.depositoId} cantidad=${row.cantidadFisica} cp=${row.costoPromedio.toString()}`,
    );
  }
}

async function applyPlan(
  prisma: PrismaClient,
  plan: InsertPlan[],
  productos: ProductoSnapshot[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const row of plan) {
      await tx.stockPorDeposito.create({
        data: {
          productoId: row.productoId,
          depositoId: row.depositoId,
          cantidadFisica: row.cantidadFisica,
          cantidadReservada: 0,
          costoPromedio: row.costoPromedio,
        },
      });
    }
    console.log(`✓ ${plan.length} rows insertados.`);
    await assertInvariantes(tx, productos);
  });
}

async function assertInvariantes(
  tx: Prisma.TransactionClient,
  productos: ProductoSnapshot[],
): Promise<void> {
  const divergencias: { codigo: string; expected: number; actual: number }[] = [];
  for (const p of productos) {
    const agg = await tx.stockPorDeposito.aggregate({
      where: { productoId: p.id },
      _sum: { cantidadFisica: true },
    });
    const actual = agg._sum.cantidadFisica ?? 0;
    if (actual !== p.stockActual) {
      divergencias.push({ codigo: p.codigo, expected: p.stockActual, actual });
    }
  }
  if (divergencias.length > 0) {
    console.error(`\n✗ ${divergencias.length} divergencias encontradas:`);
    for (const d of divergencias.slice(0, 10)) {
      console.error(`  ${d.codigo}: esperado=${d.expected} actual=${d.actual}`);
    }
    throw new Error("Backfill aborta — invariantes no satisfechos. Rollback.");
  }
  console.log(
    `✓ Invariantes OK: SUM(SPD.fisica) == Producto.stockActual para ${productos.length} productos.`,
  );
}

// ---------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------

async function ejecutarBackfill(
  prisma: PrismaClient,
  opts: CliOpts,
): Promise<void> {
  const existing = await prisma.stockPorDeposito.count();
  if (existing > 0) {
    throw new Error(
      `StockPorDeposito ya tiene ${existing} rows. Para re-ejecutar, vaciar primero la tabla.`,
    );
  }

  const productos = await prisma.producto.findMany({
    where: { OR: [{ stockActual: { not: 0 } }, { costoPromedio: { not: 0 } }] },
    select: { id: true, codigo: true, stockActual: true, costoPromedio: true },
    orderBy: { codigo: "asc" },
  });
  console.log(`✓ ${productos.length} productos con stock/costo a procesar.`);

  const plan =
    opts.mode === "all-to"
      ? await buildPlanAllTo(prisma, productos, opts)
      : await buildPlanFromCsv(prisma, productos, opts);

  console.log(`\nPlan: ${plan.length} rows StockPorDeposito a insertar.`);
  if (opts.dryRun) {
    printDryRun(plan);
    return;
  }
  await applyPlan(prisma, plan, productos);
}

// ---------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`Modo: ${opts.mode}${opts.dryRun ? " (dry-run)" : ""}`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    await ejecutarBackfill(prisma, opts);
    console.log(opts.dryRun ? "\n✓ Dry-run completo." : "\n✓ Backfill completo.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("\n✗ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
