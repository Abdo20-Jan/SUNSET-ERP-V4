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
  let count = 0;
  for (let year = 2025; year <= 2027; year++) {
    for (let month = 1; month <= 12; month++) {
      const codigo = `${year}-${String(month).padStart(2, "0")}`;
      const nombre = `${MESES_ES[month - 1]} ${year}`;
      const fechaInicio = new Date(Date.UTC(year, month - 1, 1));
      const fechaFin = new Date(Date.UTC(year, month, 0));

      await prisma.periodoContable.upsert({
        where: { codigo },
        update: { nombre, fechaInicio, fechaFin, estado: PeriodoEstado.ABIERTO },
        create: { codigo, nombre, fechaInicio, fechaFin, estado: PeriodoEstado.ABIERTO },
      });
      count++;
    }
  }
  console.log(`✓ ${count} períodos contábiles creados/actualizados (ABIERTO)`);
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
  { codigo: "2.2",    nombre: "PASIVO NO CORRIENTE",                 categoria: CuentaCategoria.PASIVO, nivel: 2 },
  { codigo: "2.2.1",  nombre: "PRÉSTAMOS LARGO PLAZO",               categoria: CuentaCategoria.PASIVO, nivel: 3 },

  // PATRIMONIO
  { codigo: "3",      nombre: "PATRIMONIO NETO",                     categoria: CuentaCategoria.PATRIMONIO, nivel: 1 },
  { codigo: "3.1",    nombre: "CAPITAL",                             categoria: CuentaCategoria.PATRIMONIO, nivel: 2 },
  { codigo: "3.1.1",  nombre: "APORTES",                             categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },
  { codigo: "3.2",    nombre: "RESULTADOS",                          categoria: CuentaCategoria.PATRIMONIO, nivel: 2 },
  { codigo: "3.2.1",  nombre: "RESULTADOS ACUMULADOS",               categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },

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
// 4. DEPÓSITOS (default minimal)
// ============================================================

const DEPOSITOS_DEFAULT = [
  {
    nombre: "Depósito Principal — Buenos Aires",
    direccion: "Av. del Libertador 1234, CABA",
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
  console.log("🌱 Iniciando seed (skeleton-only)...\n");
  await seedAdmin();
  await seedPeriodos();
  await seedCuentas();
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
