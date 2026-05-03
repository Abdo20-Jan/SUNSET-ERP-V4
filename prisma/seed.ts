import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  Role,
  PeriodoEstado,
  CuentaTipo,
  CuentaCategoria,
} from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ============================================================
// 1. USUARIO ADMIN
// ============================================================

async function seedAdmin() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      passwordHash,
      nombre: "Administrador",
      role: Role.ADMIN,
      activo: true,
    },
    create: {
      username: "admin",
      passwordHash,
      nombre: "Administrador",
      role: Role.ADMIN,
      activo: true,
    },
  });

  console.log("✓ Usuario admin creado/actualizado (username: admin)");
}

// ============================================================
// 2. PERÍODOS CONTÁBEIS (36: Jan/2025 → Dic/2027)
// ============================================================

const MESES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

async function seedPeriodos() {
  // Range exacto solicitado por el user: 12/2024 a 06/2026 (19 períodos).
  const PERIODOS: Array<{ year: number; month: number }> = [];
  PERIODOS.push({ year: 2024, month: 12 });
  for (let m = 1; m <= 12; m++) PERIODOS.push({ year: 2025, month: m });
  for (let m = 1; m <= 6; m++) PERIODOS.push({ year: 2026, month: m });

  const desiredCodes = new Set(
    PERIODOS.map(
      ({ year, month }) => `${year}-${String(month).padStart(2, "0")}`,
    ),
  );

  // 1) Eliminar períodos fuera del rango — sólo si no tienen asientos.
  const existentes = await prisma.periodoContable.findMany({
    select: {
      codigo: true,
      _count: { select: { asientos: true } },
    },
  });
  let deleted = 0;
  let skippedDelete = 0;
  for (const p of existentes) {
    if (desiredCodes.has(p.codigo)) continue;
    if (p._count.asientos > 0) {
      console.log(
        `  ⚠ skipping delete of ${p.codigo} (tiene ${p._count.asientos} asientos)`,
      );
      skippedDelete++;
      continue;
    }
    await prisma.periodoContable.delete({ where: { codigo: p.codigo } });
    deleted++;
  }

  // 2) Upsert los períodos del rango.
  let upserted = 0;
  for (const { year, month } of PERIODOS) {
    const codigo = `${year}-${String(month).padStart(2, "0")}`;
    const nombre = `${MESES_ES[month - 1]} ${year}`;
    const fechaInicio = new Date(Date.UTC(year, month - 1, 1));
    // Último día del mes a las 23:59:59.999 UTC para que cualquier `new Date()`
    // del último día caiga dentro del rango (antes era 00:00 y rompía el lookup).
    const fechaFin = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    await prisma.periodoContable.upsert({
      where: { codigo },
      update: { nombre, fechaInicio, fechaFin },
      create: {
        codigo,
        nombre,
        fechaInicio,
        fechaFin,
        estado: PeriodoEstado.ABIERTO,
      },
    });
    upserted++;
  }

  const extra = skippedDelete > 0 ? `, ${skippedDelete} fuera de rango mantenidos (tienen asientos)` : "";
  console.log(
    `✓ ${upserted} períodos en rango (12/2024 a 06/2026), ${deleted} fuera de rango eliminados${extra}`,
  );
}

// ============================================================
// 3. PLAN DE CUENTAS — SOLO ESPINA SINTETICA
// ============================================================
//
// ANALITICAs (las hojas) NO se cargan acá. Se crean automáticamente
// cuando se opera:
//   - CuentaBancaria → 1.1.1.X (caja) o 1.1.2.X (banco)
//   - Proveedor      → 2.1.1.X (nacional 10-49 / extranjero 50-99)
//   - Cliente        → 1.1.3.X
//   - Préstamo       → 2.1.7.X (CP) / 2.2.1.X (LP)
//   - Cuentas fiscales (IVA débito/crédito, IIBB, ganancias, etc.)
//     → vía cuenta-registry.ts + getOrCreateCuenta lazy en asiento
//        generators
//
// Ver: src/lib/services/cuenta-auto.ts y src/lib/services/cuenta-registry.ts

type CuentaSeed = {
  codigo: string;
  nombre: string;
  categoria: CuentaCategoria;
  nivel: number;
};

const CUENTAS_SINTETICAS: CuentaSeed[] = [
  // ACTIVO
  { codigo: "1",      nombre: "ACTIVO",                              categoria: CuentaCategoria.ACTIVO, nivel: 1 },
  { codigo: "1.1",    nombre: "ACTIVO CORRIENTE",                    categoria: CuentaCategoria.ACTIVO, nivel: 2 },
  { codigo: "1.1.1",  nombre: "CAJA",                                categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.2",  nombre: "BANCOS",                              categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.3",  nombre: "CRÉDITOS POR VENTAS",                 categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.4",  nombre: "OTROS CRÉDITOS",                      categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.5",  nombre: "BIENES DE CAMBIO",                    categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.6",  nombre: "INVERSIONES",                         categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.2",    nombre: "ACTIVO NO CORRIENTE",                 categoria: CuentaCategoria.ACTIVO, nivel: 2 },
  { codigo: "1.2.1",  nombre: "BIENES DE USO",                       categoria: CuentaCategoria.ACTIVO, nivel: 3 },

  // PASIVO
  { codigo: "2",      nombre: "PASIVO",                              categoria: CuentaCategoria.PASIVO, nivel: 1 },
  { codigo: "2.1",    nombre: "PASIVO CORRIENTE",                    categoria: CuentaCategoria.PASIVO, nivel: 2 },
  { codigo: "2.1.1",  nombre: "DEUDAS COMERCIALES",                  categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.2",  nombre: "DEUDAS BANCARIAS",                    categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.3",  nombre: "DEUDAS FISCALES",                     categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.4",  nombre: "DEUDAS SOCIALES",                     categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.5",  nombre: "IMPUESTOS NACIONALIZACIÓN",           categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.6",  nombre: "IMPUESTOS SOBRE VENTAS",              categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.7",  nombre: "PRÉSTAMOS CORTO PLAZO",               categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.8",  nombre: "PROVEEDORES DEL EXTERIOR",            categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.9",  nombre: "DIVIDENDOS A PAGAR",                  categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.2",    nombre: "PASIVO NO CORRIENTE",                 categoria: CuentaCategoria.PASIVO, nivel: 2 },
  { codigo: "2.2.1",  nombre: "PRÉSTAMOS LARGO PLAZO",               categoria: CuentaCategoria.PASIVO, nivel: 3 },

  // PATRIMONIO
  { codigo: "3",      nombre: "PATRIMONIO NETO",                     categoria: CuentaCategoria.PATRIMONIO, nivel: 1 },
  { codigo: "3.1",    nombre: "CAPITAL",                             categoria: CuentaCategoria.PATRIMONIO, nivel: 2 },
  { codigo: "3.1.1",  nombre: "APORTES",                             categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },
  { codigo: "3.1.2",  nombre: "AJUSTES DE CAPITAL",                  categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },
  { codigo: "3.2",    nombre: "RESULTADOS",                          categoria: CuentaCategoria.PATRIMONIO, nivel: 2 },
  { codigo: "3.2.1",  nombre: "RESULTADOS ACUMULADOS",               categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },
  { codigo: "3.3",    nombre: "RESERVAS",                            categoria: CuentaCategoria.PATRIMONIO, nivel: 2 },
  { codigo: "3.3.1",  nombre: "RESERVAS DE UTILIDADES",              categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },

  // INGRESOS
  { codigo: "4",      nombre: "INGRESOS",                            categoria: CuentaCategoria.INGRESO, nivel: 1 },
  { codigo: "4.1",    nombre: "INGRESOS POR VENTAS",                 categoria: CuentaCategoria.INGRESO, nivel: 2 },
  { codigo: "4.1.1",  nombre: "VENTAS NEUMÁTICOS",                   categoria: CuentaCategoria.INGRESO, nivel: 3 },
  { codigo: "4.2",    nombre: "OTROS INGRESOS",                      categoria: CuentaCategoria.INGRESO, nivel: 2 },
  { codigo: "4.2.1",  nombre: "INGRESOS VARIOS",                     categoria: CuentaCategoria.INGRESO, nivel: 3 },
  { codigo: "4.3",    nombre: "INGRESOS FINANCIEROS",                categoria: CuentaCategoria.INGRESO, nivel: 2 },
  { codigo: "4.3.1",  nombre: "RESULTADOS FINANCIEROS POSITIVOS",    categoria: CuentaCategoria.INGRESO, nivel: 3 },

  // EGRESOS
  { codigo: "5",      nombre: "EGRESOS",                             categoria: CuentaCategoria.EGRESO, nivel: 1 },
  { codigo: "5.1",    nombre: "GASTOS FIJOS - HONORARIOS",           categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.1.1",  nombre: "HONORARIOS PROFESIONALES",            categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.1.2",  nombre: "ENCARGOS LABORALES",                  categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.2",    nombre: "GASTOS FIJOS - INFRAESTRUCTURA",      categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.2.1",  nombre: "GASTOS DE INFRAESTRUCTURA",           categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.3",    nombre: "GASTOS FIJOS - SERVICIOS",            categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.3.1",  nombre: "SERVICIOS GENERALES",                 categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.4",    nombre: "GASTOS VARIABLES - PORTUARIOS",       categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.4.1",  nombre: "GASTOS PORTUARIOS",                   categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.5",    nombre: "GASTOS VARIABLES - LOGÍSTICA",        categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.5.1",  nombre: "GASTOS LOGÍSTICOS",                   categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.6",    nombre: "GASTOS VARIABLES - DESPACHANTE",      categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.6.1",  nombre: "GASTOS DESPACHANTE",                  categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.7",    nombre: "IMPUESTOS NACIONALIZACIÓN (EGRESOS)", categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.7.1",  nombre: "DERECHOS E IMPUESTOS",                categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.8",    nombre: "GASTOS FINANCIEROS",                  categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.8.1",  nombre: "COSTOS FINANCIEROS",                  categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.8.2",  nombre: "RESULTADOS FINANCIEROS NEGATIVOS",    categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.9",    nombre: "PROVISIONES Y CONTINGENCIAS",         categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.9.1",  nombre: "PROVISIONES",                         categoria: CuentaCategoria.EGRESO, nivel: 3 },
];

function derivePadreCodigo(codigo: string): string | null {
  const lastDot = codigo.lastIndexOf(".");
  if (lastDot === -1) return null;
  return codigo.slice(0, lastDot);
}

async function seedCuentas() {
  for (const c of CUENTAS_SINTETICAS) {
    const padreCodigo = derivePadreCodigo(c.codigo);
    const data = {
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: CuentaTipo.SINTETICA,
      categoria: c.categoria,
      nivel: c.nivel,
      padreCodigo,
      activa: true,
    };
    await prisma.cuentaContable.upsert({
      where: { codigo: c.codigo },
      update: data,
      create: data,
    });
  }
  console.log(
    `✓ ${CUENTAS_SINTETICAS.length} cuentas SINTETICAS (espina del plan) creadas/actualizadas`,
  );
  console.log(
    "   ANALITICAs se auto-crean al operar (cajas, bancos, proveedores, clientes, fiscales).",
  );
}

// ============================================================
// 3.1. ANALITICAs base — cuentas que el motor contable no
// auto-crea pero que el usuario necesita seleccionar como
// contrapartida en movimientos manuales (aportes, intereses,
// comisiones, diferencia de cambio, etc.). Patrimônio +
// ingresos/egresos financieros básicos.
// ============================================================

type AnaliticaBaseSeed = {
  codigo: string;
  nombre: string;
  categoria: CuentaCategoria;
};

const ANALITICAS_BASE: AnaliticaBaseSeed[] = [
  // Patrimônio (necesario para aportes y cierres)
  { codigo: "3.1.1.01", nombre: "CAPITAL SOCIAL",                      categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.1.1.02", nombre: "APORTES IRREVOCABLES",                categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.1.2.01", nombre: "AJUSTE INTEGRAL DE CAPITAL",          categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.1.2.02", nombre: "PRIMA DE EMISIÓN",                    categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.2.1.01", nombre: "RESULTADOS EJERCICIOS ANTERIORES",    categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.2.1.02", nombre: "RESULTADO DEL EJERCICIO",             categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.2.1.03", nombre: "DIVIDENDOS DECLARADOS",               categoria: CuentaCategoria.PATRIMONIO },
  // Reservas (Ley 19.550 — RT 8/9). RESERVA LEGAL es obligatoria: 5%
  // de la utilidad neta hasta alcanzar 20% del capital social.
  { codigo: "3.3.1.01", nombre: "RESERVA LEGAL",                       categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.3.1.02", nombre: "RESERVA FACULTATIVA",                 categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.3.1.03", nombre: "RESERVA ESTATUTARIA",                 categoria: CuentaCategoria.PATRIMONIO },
  { codigo: "3.3.1.04", nombre: "RESERVA POR REVALÚO TÉCNICO",         categoria: CuentaCategoria.PATRIMONIO },

  // Pasivo — provisión de dividendos a pagar (contrapartida del DEBE
  // 3.2.1.03 al declarar dividendos antes del pago efectivo).
  { codigo: "2.1.9.01", nombre: "DIVIDENDOS A PAGAR",                  categoria: CuentaCategoria.PASIVO },

  // Inversiones FCI por banco. 1.1.6.01 queda como genérica (legacy).
  { codigo: "1.1.6.02", nombre: "INVERSIONES — SANTANDER SUPERFONDOS PESOS", categoria: CuentaCategoria.ACTIVO },
  { codigo: "1.1.6.03", nombre: "INVERSIONES — GALICIA FONDOS FIMA PESOS",   categoria: CuentaCategoria.ACTIVO },

  // Ingresos no operativos
  { codigo: "4.2.1.01", nombre: "DESCUENTOS OBTENIDOS",                categoria: CuentaCategoria.INGRESO },
  { codigo: "4.2.1.02", nombre: "INTERESES GANADOS",                   categoria: CuentaCategoria.INGRESO },
  { codigo: "4.3.1.01", nombre: "DIFERENCIA DE CAMBIO POSITIVA",       categoria: CuentaCategoria.INGRESO },

  // Egresos financieros
  { codigo: "5.8.1.01", nombre: "COMISIONES BANCARIAS",                categoria: CuentaCategoria.EGRESO },
  { codigo: "5.8.1.02", nombre: "GASTOS TRANSFERENCIA EXTERIOR",       categoria: CuentaCategoria.EGRESO },
  { codigo: "5.8.1.06", nombre: "IMPUESTO LEY 25413 (DEB/CRED BANCARIOS)", categoria: CuentaCategoria.EGRESO },
  { codigo: "5.8.2.01", nombre: "DIFERENCIA DE CAMBIO NEGATIVA",       categoria: CuentaCategoria.EGRESO },
  { codigo: "5.8.2.02", nombre: "INTERESES PAGADOS",                   categoria: CuentaCategoria.EGRESO },
];

async function seedAnaliticasBase() {
  for (const c of ANALITICAS_BASE) {
    const padreCodigo = derivePadreCodigo(c.codigo);
    const data = {
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: CuentaTipo.ANALITICA,
      categoria: c.categoria,
      nivel: c.codigo.split(".").length,
      padreCodigo,
      activa: true,
    };
    await prisma.cuentaContable.upsert({
      where: { codigo: c.codigo },
      update: data,
      create: data,
    });
  }
  console.log(
    `✓ ${ANALITICAS_BASE.length} cuentas ANALITICAs base (patrimônio, intereses, comisiones, etc.) creadas/actualizadas`,
  );
}

// ============================================================
// 4. DEPÓSITOS (default — alineado con stock dual W3)
// ============================================================
// Sunset Tires opera en 2 depósitos físicos:
//
//  - NACIONAL: mercadería ya nacionalizada (con DIA cerrado), disponible
//    para venta. Es el depósito por defecto para emisión de venta.
//
//  - ZONA PRIMARIA ADUANEIRA: mercadería que llegó al puerto / zona
//    primaria pero aún no fue nacionalizada. Bloqueada para venta hasta
//    que se cierre el despacho. Concepto fiscal AR (ver
//    `crearAsientoZonaPrimaria` en src/lib/services/asiento-automatico.ts).
//
// Idempotente: si ya existe un Deposito con el mismo `nombre`, se
// actualiza; si no, se crea. NO se elimina ni se renombra ningún
// Deposito pre-existente con otros nombres (caso de instalaciones
// previas a W3 con nomenclatura propia).
const DEPOSITOS_DEFAULT = [
  {
    nombre: "NACIONAL",
    direccion: "Depósito propio — mercadería nacionalizada",
    activo: true,
  },
  {
    nombre: "ZONA PRIMARIA ADUANEIRA",
    direccion: "Mercadería en zona primaria — pendiente de despacho",
    activo: true,
  },
];

async function seedDepositos() {
  for (const d of DEPOSITOS_DEFAULT) {
    const existing = await prisma.deposito.findFirst({
      where: { nombre: d.nombre },
      select: { id: true },
    });
    if (existing) {
      await prisma.deposito.update({ where: { id: existing.id }, data: d });
    } else {
      await prisma.deposito.create({ data: d });
    }
  }
  console.log(`✓ ${DEPOSITOS_DEFAULT.length} depósitos creados/actualizados`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("🌱 Iniciando seed (skeleton + analíticas base)...\n");
  await seedAdmin();
  await seedPeriodos();
  await seedCuentas();
  await seedAnaliticasBase();
  await seedDepositos();
  console.log("\n✅ Seed completado. Sistema listo para auto-construir el plan analítico.");
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
