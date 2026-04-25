import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  Role,
  PeriodoEstado,
  CuentaTipo,
  CuentaCategoria,
  TipoCuentaBancaria,
  Moneda,
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
// 3. PLANO DE CONTAS (fonte: vault Obsidian `01-contabilidad/plan-de-cuentas.md`)
// ============================================================

type CuentaSeed = {
  codigo: string;
  nombre: string;
  tipo: CuentaTipo;
  categoria: CuentaCategoria;
  nivel: number;
};

const CUENTAS: CuentaSeed[] = [
  // ACTIVO
  { codigo: "1",        nombre: "ACTIVO",                              tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 1 },
  { codigo: "1.1",      nombre: "ACTIVO CORRIENTE",                    tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 2 },
  { codigo: "1.1.1",    nombre: "CAJA",                                tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.1.01", nombre: "CAJA PESOS",                          tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.1.02", nombre: "CAJA DÓLARES",                        tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.1.03", nombre: "CAJA CHICA PESOS",                    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.2",    nombre: "BANCOS",                              tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.2.01", nombre: "BANCO SANTANDER PESOS",               tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.2.02", nombre: "BANCO SANTANDER DÓLARES",             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.2.03", nombre: "BANCO GALICIA PESOS",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.2.04", nombre: "BANCO GALICIA DÓLARES",               tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.3",    nombre: "CRÉDITOS POR VENTAS",                 tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.3.01", nombre: "DEUDORES POR VENTAS",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.3.02", nombre: "DOCUMENTOS A COBRAR",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4",    nombre: "OTROS CRÉDITOS",                      tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.4.01", nombre: "IVA CRÉDITO FISCAL",                  tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.02", nombre: "ANTICIPOS A PROVEEDORES",             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.03", nombre: "RETENCIONES SUFRIDAS",                tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.04", nombre: "IVA CRÉDITO FISCAL IMPORTACIÓN",      tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.05", nombre: "IVA ADICIONAL IMPORTACIÓN",           tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.06", nombre: "PERCEPCIÓN IIBB IMPORTACIÓN",         tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.07", nombre: "PERCEPCIÓN GANANCIAS IMPORTACIÓN",    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.08", nombre: "IVA CRÉDITO FISCAL COMPRAS",          tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.09", nombre: "CRÉDITO FISCAL COMISIONES BANCARIAS", tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.10", nombre: "RETENCIÓN GANANCIAS COMPRAS",         tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.4.11", nombre: "CRÉDITO INGRESOS BRUTOS COMPRAS",     tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.5",    nombre: "BIENES DE CAMBIO",                    tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.1.5.01", nombre: "MERCADERÍAS",                         tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.1.5.02", nombre: "MERCADERÍAS EN TRÁNSITO",             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.2",      nombre: "ACTIVO NO CORRIENTE",                 tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 2 },
  { codigo: "1.2.1",    nombre: "BIENES DE USO",                       tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.ACTIVO, nivel: 3 },
  { codigo: "1.2.1.01", nombre: "RODADOS",                             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.2.1.02", nombre: "MUEBLES Y ÚTILES",                    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },
  { codigo: "1.2.1.03", nombre: "EQUIPOS DE COMPUTACIÓN",              tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.ACTIVO, nivel: 4 },

  // PASIVO
  { codigo: "2",        nombre: "PASIVO",                              tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 1 },
  { codigo: "2.1",      nombre: "PASIVO CORRIENTE",                    tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 2 },
  { codigo: "2.1.1",    nombre: "DEUDAS COMERCIALES",                  tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.1.01", nombre: "PROVEEDORES LOCALES",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.1.02", nombre: "PROVEEDORES DEL EXTERIOR",            tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.1.03", nombre: "DESPACHANTE POR PAGAR",               tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.2",    nombre: "DEUDAS BANCARIAS",                    tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.2.01", nombre: "PRÉSTAMOS BANCARIOS CP",              tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.3",    nombre: "DEUDAS FISCALES",                     tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.3.01", nombre: "IVA DÉBITO FISCAL",                   tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.3.02", nombre: "IIBB POR PAGAR",                      tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.3.03", nombre: "GANANCIAS POR PAGAR",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.3.04", nombre: "OTROS IMPUESTOS",                     tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.3.05", nombre: "RETENCIONES GANANCIAS POR PAGAR",     tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.3.06", nombre: "RETENCIONES IIBB POR PAGAR",          tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.4",    nombre: "DEUDAS SOCIALES",                     tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.4.01", nombre: "SUELDOS POR PAGAR",                   tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.4.02", nombre: "CARGAS SOCIALES POR PAGAR",           tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.5",    nombre: "IMPUESTOS NACIONALIZACIÓN",           tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.5.01", nombre: "DERECHOS DE IMPORTACIÓN",             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.5.02", nombre: "TASA ESTADÍSTICA",                    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.5.03", nombre: "ARANCEL SIM IMP",                     tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.5.04", nombre: "IVA IMPORTACIÓN POR PAGAR",           tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.6",    nombre: "IMPUESTOS SOBRE VENTAS",              tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.6.01", nombre: "IVA VENTAS POR PAGAR",                tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.7",    nombre: "PRÉSTAMOS CORTO PLAZO",               tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.1.7.01", nombre: "BANCO SANTANDER EMPRÉSTIMO CP",       tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.7.02", nombre: "BANCO GALICIA EMPRÉSTIMO CP",         tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.7.03", nombre: "SUNSET SACIS EMPRÉSTIMO CP",          tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.7.04", nombre: "OTROS PRÉSTAMOS CP",                  tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.1.7.05", nombre: "PRÉSTAMOS EXTERIOR CP",               tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.2",      nombre: "PASIVO NO CORRIENTE",                 tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 2 },
  { codigo: "2.2.1",    nombre: "PRÉSTAMOS LARGO PLAZO",               tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PASIVO, nivel: 3 },
  { codigo: "2.2.1.01", nombre: "BANCO SANTANDER EMPRÉSTIMO LP",       tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.2.1.02", nombre: "BANCO GALICIA EMPRÉSTIMO LP",         tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },
  { codigo: "2.2.1.03", nombre: "SUNSET SACIS EMPRÉSTIMO LP",          tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PASIVO, nivel: 4 },

  // PATRIMONIO
  { codigo: "3",        nombre: "PATRIMONIO NETO",                     tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 1 },
  { codigo: "3.1",      nombre: "CAPITAL",                             tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 2 },
  { codigo: "3.1.1",    nombre: "APORTES",                             tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },
  { codigo: "3.1.1.01", nombre: "CAPITAL SOCIAL",                      tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 4 },
  { codigo: "3.1.1.02", nombre: "APORTES IRREVOCABLES",                tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 4 },
  { codigo: "3.2",      nombre: "RESULTADOS",                          tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 2 },
  { codigo: "3.2.1",    nombre: "RESULTADOS ACUMULADOS",               tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 3 },
  { codigo: "3.2.1.01", nombre: "RESULTADOS EJERCICIOS ANTERIORES",    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 4 },
  { codigo: "3.2.1.02", nombre: "RESULTADO DEL EJERCICIO",             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.PATRIMONIO, nivel: 4 },

  // INGRESOS
  { codigo: "4",        nombre: "INGRESOS",                            tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.INGRESO, nivel: 1 },
  { codigo: "4.1",      nombre: "INGRESOS POR VENTAS",                 tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.INGRESO, nivel: 2 },
  { codigo: "4.1.1",    nombre: "VENTAS NEUMÁTICOS",                   tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.INGRESO, nivel: 3 },
  { codigo: "4.1.1.01", nombre: "VENTAS NEUMÁTICOS NUEVOS",            tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.INGRESO, nivel: 4 },
  { codigo: "4.1.1.02", nombre: "VENTAS NEUMÁTICOS USADOS",            tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.INGRESO, nivel: 4 },
  { codigo: "4.2",      nombre: "OTROS INGRESOS",                      tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.INGRESO, nivel: 2 },
  { codigo: "4.2.1",    nombre: "INGRESOS VARIOS",                     tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.INGRESO, nivel: 3 },
  { codigo: "4.2.1.01", nombre: "DESCUENTOS OBTENIDOS",                tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.INGRESO, nivel: 4 },
  { codigo: "4.2.1.02", nombre: "INTERESES GANADOS",                   tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.INGRESO, nivel: 4 },
  { codigo: "4.3",      nombre: "INGRESOS FINANCIEROS",                tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.INGRESO, nivel: 2 },
  { codigo: "4.3.1",    nombre: "RESULTADOS FINANCIEROS POSITIVOS",    tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.INGRESO, nivel: 3 },
  { codigo: "4.3.1.01", nombre: "DIFERENCIA DE CAMBIO POSITIVA",       tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.INGRESO, nivel: 4 },

  // EGRESOS
  { codigo: "5",        nombre: "EGRESOS",                             tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 1 },
  { codigo: "5.1",      nombre: "GASTOS FIJOS - HONORARIOS",           tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.1.1",    nombre: "HONORARIOS PROFESIONALES",            tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.1.1.01", nombre: "HONORARIOS CONTABLES",                tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.1.1.02", nombre: "HONORARIOS LEGALES",                  tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.1.1.03", nombre: "HONORARIOS DESPACHANTE",              tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.1.2",    nombre: "ENCARGOS LABORALES",                  tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.1.2.01", nombre: "ENCARGOS LABORALES HONORARIOS",       tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.2",      nombre: "GASTOS FIJOS - INFRAESTRUCTURA",      tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.2.1",    nombre: "GASTOS DE INFRAESTRUCTURA",           tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.2.1.01", nombre: "ALQUILER",                            tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.2.1.02", nombre: "SERVICIOS (LUZ, GAS, AGUA)",          tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.2.1.03", nombre: "SEGUROS",                             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.2.1.04", nombre: "DEPÓSITO EN GARANTÍA",                tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.3",      nombre: "GASTOS FIJOS - SERVICIOS",            tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.3.1",    nombre: "SERVICIOS GENERALES",                 tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.3.1.01", nombre: "COMUNICACIONES",                      tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.3.1.02", nombre: "SISTEMAS Y SOFTWARE",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.3.1.03", nombre: "HONORARIOS CONTADOR",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.4",      nombre: "GASTOS VARIABLES - PORTUARIOS",       tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.4.1",    nombre: "GASTOS PORTUARIOS",                   tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.4.1.01", nombre: "GASTOS PORTUARIOS",                   tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.4.1.02", nombre: "AGENTE DE CARGAS",                    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.5",      nombre: "GASTOS VARIABLES - LOGÍSTICA",        tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.5.1",    nombre: "GASTOS LOGÍSTICOS",                   tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.5.1.01", nombre: "FLETE NACIONAL",                      tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.5.1.02", nombre: "FLETE INTERNACIONAL",                 tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.5.1.03", nombre: "OPERADOR LOGÍSTICO",                  tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.5.1.04", nombre: "DEVOLUCIÓN CONTENEDOR",               tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.5.1.05", nombre: "ALMACENAJE Y WMS",                    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.5.1.06", nombre: "SEGURO MARÍTIMO",                     tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.6",      nombre: "GASTOS VARIABLES - DESPACHANTE",      tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.6.1",    nombre: "GASTOS DESPACHANTE",                  tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.6.1.01", nombre: "HONORARIOS DESPACHANTE IMPORT",       tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.7",      nombre: "IMPUESTOS NACIONALIZACIÓN",           tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.7.1",    nombre: "DERECHOS E IMPUESTOS",                tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.7.1.01", nombre: "DERECHOS DE IMPORTACIÓN",             tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.7.1.02", nombre: "TASA ESTADÍSTICA",                    tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.7.1.03", nombre: "ARANCEL SIM IMP",                     tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.8",      nombre: "GASTOS FINANCIEROS",                  tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 2 },
  { codigo: "5.8.1",    nombre: "COSTOS FINANCIEROS",                  tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.8.1.01", nombre: "COMISIONES BANCARIAS",                tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.8.1.02", nombre: "GASTOS TRANSFERENCIA EXTERIOR",       tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.8.2",    nombre: "RESULTADOS FINANCIEROS NEGATIVOS",    tipo: CuentaTipo.SINTETICA, categoria: CuentaCategoria.EGRESO, nivel: 3 },
  { codigo: "5.8.2.01", nombre: "DIFERENCIA DE CAMBIO NEGATIVA",       tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
  { codigo: "5.8.2.02", nombre: "INTERESES PAGADOS",                   tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO, nivel: 4 },
];

function derivePadreCodigo(codigo: string): string | null {
  const lastDot = codigo.lastIndexOf(".");
  if (lastDot === -1) return null;
  return codigo.slice(0, lastDot);
}

async function seedCuentas() {
  for (const c of CUENTAS) {
    const padreCodigo = derivePadreCodigo(c.codigo);
    const data = {
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
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
  console.log(`✓ ${CUENTAS.length} cuentas contábiles creadas/actualizadas`);
}

// ============================================================
// 4. CUENTAS BANCARIAS (linked to accounts from chart)
// ============================================================

type CuentaBancariaSeed = {
  banco: string;
  tipo: TipoCuentaBancaria;
  moneda: Moneda;
  numero: string;
  cbu: string | null;
  alias: string | null;
  cuentaContableCodigo: string;
};

const CUENTAS_BANCARIAS: CuentaBancariaSeed[] = [
  {
    banco: "Banco Santander",
    tipo: TipoCuentaBancaria.CUENTA_CORRIENTE,
    moneda: Moneda.ARS,
    numero: "SANT-ARS-001",
    cbu: null,
    alias: "SANTANDER.PESOS",
    cuentaContableCodigo: "1.1.2.01",
  },
  {
    banco: "Banco Santander",
    tipo: TipoCuentaBancaria.CAJA_AHORRO,
    moneda: Moneda.USD,
    numero: "SANT-USD-001",
    cbu: null,
    alias: "SANTANDER.DOLARES",
    cuentaContableCodigo: "1.1.2.02",
  },
  {
    banco: "Banco Galicia",
    tipo: TipoCuentaBancaria.CUENTA_CORRIENTE,
    moneda: Moneda.ARS,
    numero: "GAL-ARS-001",
    cbu: null,
    alias: "GALICIA.PESOS",
    cuentaContableCodigo: "1.1.2.03",
  },
  {
    banco: "Banco Galicia",
    tipo: TipoCuentaBancaria.CAJA_AHORRO,
    moneda: Moneda.USD,
    numero: "GAL-USD-001",
    cbu: null,
    alias: "GALICIA.DOLARES",
    cuentaContableCodigo: "1.1.2.04",
  },
  {
    banco: "Caja Chica",
    tipo: TipoCuentaBancaria.CAJA_CHICA,
    moneda: Moneda.ARS,
    numero: "CAJA-CHICA-001",
    cbu: null,
    alias: "CAJA.CHICA",
    cuentaContableCodigo: "1.1.1.03",
  },
];

async function seedCuentasBancarias() {
  for (const c of CUENTAS_BANCARIAS) {
    const cuentaContable = await prisma.cuentaContable.findUnique({
      where: { codigo: c.cuentaContableCodigo },
      select: { id: true },
    });
    if (!cuentaContable) {
      throw new Error(
        `Cuenta contable ${c.cuentaContableCodigo} inexistente. Seed CUENTAS primero.`,
      );
    }

    const existing = await prisma.cuentaBancaria.findFirst({
      where: { numero: c.numero, banco: c.banco },
      select: { id: true },
    });

    const data = {
      banco: c.banco,
      tipo: c.tipo,
      moneda: c.moneda,
      numero: c.numero,
      cbu: c.cbu,
      alias: c.alias,
      cuentaContableId: cuentaContable.id,
    };

    if (existing) {
      await prisma.cuentaBancaria.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.cuentaBancaria.create({ data });
    }
  }
  console.log(`✓ ${CUENTAS_BANCARIAS.length} cuentas bancarias creadas/actualizadas`);
}

// ============================================================
// DEPÓSITOS
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
  console.log("🌱 Iniciando seed...\n");
  await seedAdmin();
  await seedPeriodos();
  await seedCuentas();
  await seedCuentasBancarias();
  await seedDepositos();
  console.log("\n✅ Seed completado con éxito.");
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
