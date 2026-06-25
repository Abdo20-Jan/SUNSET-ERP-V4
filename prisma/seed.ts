import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role, PeriodoEstado, TipoDeposito } from "../src/generated/prisma/client";
import {
  PLAN_CUENTAS,
  planEntryToSeedRecord,
  validarPlan,
} from "../src/lib/services/plan-de-cuentas";
import { PERMISSION_CATALOG, USER_BASE_CLAVES } from "../src/lib/permisos-catalog";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ============================================================
// 1. USUARIO ADMIN
// ============================================================

async function seedAdmin() {
  // Password do admin do seed vem de env var, com fallback para dev local.
  // Nunca hardcodar credenciais reais aqui — em produção, defina SEED_ADMIN_PASSWORD
  // via Vercel env (sem ela, o seed usa a senha padrão e o usuário deve trocá-la).
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

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
    PERIODOS.map(({ year, month }) => `${year}-${String(month).padStart(2, "0")}`),
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
      console.log(`  ⚠ skipping delete of ${p.codigo} (tiene ${p._count.asientos} asientos)`);
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

  const extra =
    skippedDelete > 0 ? `, ${skippedDelete} fuera de rango mantenidos (tienen asientos)` : "";
  console.log(
    `✓ ${upserted} períodos en rango (12/2024 a 06/2026), ${deleted} fuera de rango eliminados${extra}`,
  );
}

// ============================================================
// 3. PLAN DE CUENTAS (modelo de 9 clases, 631 cuentas)
// ============================================================
// Fuente única: PLAN_CUENTAS (src/lib/services/plan-de-cuentas.ts; dato en
// plan-de-cuentas.data.ts, generado del Excel maestro). Mismo comportamiento
// que el seed dedicado prisma/seed-plan-de-cuentas.ts: upsert idempotente por
// código, padres antes que hijos (orden por nivel, luego orden).

async function seedPlanDeCuentas() {
  const problemas = validarPlan(PLAN_CUENTAS);
  if (problemas.length > 0) {
    for (const pr of problemas) console.error(`  [${pr.regla}] ${pr.codigo}: ${pr.detalle}`);
    throw new Error(`PLAN_CUENTAS inconsistente (${problemas.length})`);
  }
  const registros = PLAN_CUENTAS.map(planEntryToSeedRecord).sort(
    (a, b) => a.nivel - b.nivel || a.orden - b.orden,
  );
  for (const r of registros) {
    const data = {
      nombre: r.nombre,
      tipo: r.tipo,
      categoria: r.categoria,
      clase: r.clase,
      clasificacion: r.clasificacion,
      orden: r.orden,
      nivel: r.nivel,
      padreCodigo: r.padreCodigo,
      activa: r.activa,
      naturaleza: r.naturaleza,
      moneda: r.moneda,
      imputacion: r.imputacion,
      regularizadora: r.regularizadora,
      bimonetaria: r.bimonetaria,
      monedaExtranjera: r.monedaExtranjera,
      enEspecie: r.enEspecie,
      inventariable: r.inventariable,
      sistema: r.sistema,
      dinamica: r.dinamica,
      rubroEECC: r.rubroEECC,
    };
    await prisma.cuentaContable.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, ...data },
      update: data,
    });
  }
  console.log(`✓ ${registros.length} cuentas del plan (9 clases) creadas/actualizadas`);
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
    tipo: TipoDeposito.NACIONAL,
  },
  {
    nombre: "ZONA PRIMARIA ADUANEIRA",
    direccion: "Mercadería en zona primaria — pendiente de despacho",
    activo: true,
    tipo: TipoDeposito.ZONA_PRIMARIA,
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
// PIPELINE STAGES CRM (W4) — 6 stages default
// ============================================================

async function seedPipelineStages() {
  const stages = [
    { orden: 1, nombre: "Nuevo", esGanada: false, esPerdida: false },
    { orden: 2, nombre: "Calificado", esGanada: false, esPerdida: false },
    { orden: 3, nombre: "Propuesta", esGanada: false, esPerdida: false },
    { orden: 4, nombre: "Negociación", esGanada: false, esPerdida: false },
    { orden: 5, nombre: "Ganado", esGanada: true, esPerdida: false },
    { orden: 6, nombre: "Perdido", esGanada: false, esPerdida: true },
  ];

  for (const stage of stages) {
    await prisma.pipelineStage.upsert({
      where: { orden: stage.orden },
      update: {
        nombre: stage.nombre,
        esGanada: stage.esGanada,
        esPerdida: stage.esPerdida,
        activo: true,
      },
      create: { ...stage, activo: true },
    });
  }

  console.log(`✓ ${stages.length} pipeline stages CRM creados/actualizados`);
}

// ============================================================
// PROVINCIAS AR + JURISDICCIONES IIBB
// ============================================================

// Datos de Comisión Arbitral CM + tabla "iibb-tabla-completa-24-jurisdicciones"
// de la skill `tributos-ventas-argentina`. Las alícuotas son las de
// "comercialización general mayorista" — sirven como default para
// Percepción IIBB cuando el cliente no tiene override en padrón.
//
// `esAgentePercepcion`: por decisión del negocio, Sunset percepciona
// en TODAS las provincias (Convenio Multilateral). La alícuota usada
// es la default del padrón provincial; cliente puede tener override.
const PROVINCIAS_AR: Array<{
  codigo: string;
  nombre: string;
  codigoAfip: string;
  alicuotaPercepcion: string;
  esAgentePercepcion: boolean;
}> = [
  {
    codigo: "CABA",
    nombre: "Ciudad Autónoma de Buenos Aires",
    codigoAfip: "901",
    alicuotaPercepcion: "3.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "BA",
    nombre: "Buenos Aires",
    codigoAfip: "902",
    alicuotaPercepcion: "5.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "CAT",
    nombre: "Catamarca",
    codigoAfip: "903",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "CBA",
    nombre: "Córdoba",
    codigoAfip: "904",
    alicuotaPercepcion: "4.7500",
    esAgentePercepcion: true,
  },
  {
    codigo: "COR",
    nombre: "Corrientes",
    codigoAfip: "905",
    alicuotaPercepcion: "5.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "CHA",
    nombre: "Chaco",
    codigoAfip: "906",
    alicuotaPercepcion: "4.7500",
    esAgentePercepcion: true,
  },
  {
    codigo: "CHU",
    nombre: "Chubut",
    codigoAfip: "907",
    alicuotaPercepcion: "4.5000",
    esAgentePercepcion: true,
  },
  {
    codigo: "ER",
    nombre: "Entre Ríos",
    codigoAfip: "908",
    alicuotaPercepcion: "5.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "FOR",
    nombre: "Formosa",
    codigoAfip: "909",
    alicuotaPercepcion: "4.5000",
    esAgentePercepcion: true,
  },
  {
    codigo: "JUJ",
    nombre: "Jujuy",
    codigoAfip: "910",
    alicuotaPercepcion: "3.5000",
    esAgentePercepcion: true,
  },
  {
    codigo: "LP",
    nombre: "La Pampa",
    codigoAfip: "911",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "LR",
    nombre: "La Rioja",
    codigoAfip: "912",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "MZA",
    nombre: "Mendoza",
    codigoAfip: "913",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "MIS",
    nombre: "Misiones",
    codigoAfip: "914",
    alicuotaPercepcion: "5.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "NEU",
    nombre: "Neuquén",
    codigoAfip: "915",
    alicuotaPercepcion: "5.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "RN",
    nombre: "Río Negro",
    codigoAfip: "916",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "SAL",
    nombre: "Salta",
    codigoAfip: "917",
    alicuotaPercepcion: "3.6000",
    esAgentePercepcion: true,
  },
  {
    codigo: "SJ",
    nombre: "San Juan",
    codigoAfip: "918",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "SL",
    nombre: "San Luis",
    codigoAfip: "919",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "SC",
    nombre: "Santa Cruz",
    codigoAfip: "920",
    alicuotaPercepcion: "5.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "SF",
    nombre: "Santa Fe",
    codigoAfip: "921",
    alicuotaPercepcion: "4.5000",
    esAgentePercepcion: true,
  },
  {
    codigo: "SDE",
    nombre: "Santiago del Estero",
    codigoAfip: "922",
    alicuotaPercepcion: "4.5000",
    esAgentePercepcion: true,
  },
  {
    codigo: "TDF",
    nombre: "Tierra del Fuego",
    codigoAfip: "923",
    alicuotaPercepcion: "4.0000",
    esAgentePercepcion: true,
  },
  {
    codigo: "TUC",
    nombre: "Tucumán",
    codigoAfip: "924",
    alicuotaPercepcion: "4.5000",
    esAgentePercepcion: true,
  },
];

async function seedProvinciasYJurisdicciones() {
  for (const prov of PROVINCIAS_AR) {
    const provincia = await prisma.provincia.upsert({
      where: { codigo: prov.codigo },
      update: { nombre: prov.nombre, codigoAfip: prov.codigoAfip },
      create: { codigo: prov.codigo, nombre: prov.nombre, codigoAfip: prov.codigoAfip },
    });

    await prisma.jurisdiccionIIBB.upsert({
      where: { codigo: prov.codigo },
      update: {
        nombre: prov.nombre,
        alicuotaPercepcion: prov.alicuotaPercepcion,
        esAgentePercepcion: prov.esAgentePercepcion,
        provinciaId: provincia.id,
      },
      create: {
        codigo: prov.codigo,
        nombre: prov.nombre,
        alicuotaPercepcion: prov.alicuotaPercepcion,
        esAgentePercepcion: prov.esAgentePercepcion,
        provinciaId: provincia.id,
      },
    });
  }

  const agentes = PROVINCIAS_AR.filter((p) => p.esAgentePercepcion).map((p) => p.codigo);
  console.log(
    `✓ ${PROVINCIAS_AR.length} provincias + jurisdicciones IIBB creadas/actualizadas (agente Percepción: ${agentes.join(", ")})`,
  );
}

// ============================================================
// RBAC FOUNDATION (PR-006): catálogo de permisos + perfiles de sistema + grants
// ============================================================

function upsertPerfilSistema(codigo: string, nombre: string, descripcion: string) {
  return prisma.perfil.upsert({
    where: { codigo },
    update: { nombre, descripcion, esSistema: true, activo: true },
    create: { codigo, nombre, descripcion, esSistema: true, activo: true },
  });
}

async function grantClaves(
  perfilId: string,
  catalogo: { id: string; clave: string }[],
  claves: ReadonlySet<string>,
) {
  for (const permiso of catalogo) {
    if (!claves.has(permiso.clave)) continue;
    await prisma.perfilPermiso.upsert({
      where: { perfilId_permisoId: { perfilId, permisoId: permiso.id } },
      update: {},
      create: { perfilId, permisoId: permiso.id },
    });
  }
}

// Reproduce el acceso de HOY: ADMIN → todas las claves; USER → sólo base.
// Idempotente (upserts por clave/codigo/PK compuesta). Con la flag RBAC OFF
// estos datos quedan inertes; sólo importan cuando se prende RBAC_ENABLED.
async function seedRbacFoundation() {
  // (a) Catálogo de permisos — idempotente por `clave`.
  for (const p of PERMISSION_CATALOG) {
    await prisma.permiso.upsert({
      where: { clave: p.clave },
      update: { dimension: p.dimension, descripcion: p.descripcion },
      create: { clave: p.clave, dimension: p.dimension, descripcion: p.descripcion },
    });
  }

  // (b) Perfiles de sistema — idempotente por `codigo`.
  const perfilAdmin = await upsertPerfilSistema(
    "ADMIN",
    "Administrador",
    "Reproduce el acceso ADMIN de hoy (todos los permisos).",
  );
  const perfilUser = await upsertPerfilSistema(
    "USER",
    "Usuario",
    "Reproduce el acceso USER de hoy (acceso base).",
  );

  // (c) Grants: ADMIN = todo el catálogo; USER = subconjunto base.
  const catalogo = await prisma.permiso.findMany({ select: { id: true, clave: true } });
  await grantClaves(perfilAdmin.id, catalogo, new Set(catalogo.map((c) => c.clave)));
  await grantClaves(perfilUser.id, catalogo, new Set(USER_BASE_CLAVES));

  // (d) Asigna el perfil ADMIN al usuario admin del seed (idempotente).
  await prisma.user.update({ where: { username: "admin" }, data: { perfilId: perfilAdmin.id } });

  console.log(
    `✓ RBAC foundation: ${PERMISSION_CATALOG.length} permisos, perfiles ADMIN/USER, admin→ADMIN`,
  );
}

// ============================================================
// PERFILES CANÓNICOS (PR-009 — PERM-01): shells SIN grants
// ============================================================
// Los 12 perfiles canónicos del spec PERM-01. "Master" ≈ perfil de sistema
// ADMIN (ya sembrado por seedRbacFoundation, esSistema=true), así que acá sólo
// sembramos los 11 restantes como SHELLS: esSistema=false (editables/borrables
// por el Master en la UI) y SIN grants pre-cargados — el Master configura los
// permisos por la matriz (PR-009). Idempotente por `codigo`; `update: {}` para
// no pisar los ajustes que el Master haya hecho luego del primer seed. Con la
// flag RBAC OFF (default) estos datos quedan inertes: ningún usuario queda
// asignado a ellos ⇒ CERO cambio de comportamiento.
const PERFILES_CANONICOS: ReadonlyArray<{ codigo: string; nombre: string; descripcion: string }> = [
  {
    codigo: "DIRECTOR",
    nombre: "Diretor",
    descripcion: "Visión global, aprobaciones estratégicas.",
  },
  {
    codigo: "FINANCIERO",
    nombre: "Financeiro",
    descripcion: "Programación, crédito, cobranza, CxC, CxP.",
  },
  {
    codigo: "TESORERIA",
    nombre: "Tesouraria",
    descripcion: "Ejecución de pagos/cobros, conciliación.",
  },
  {
    codigo: "CONTABILIDAD",
    nombre: "Contabilidade",
    descripcion: "Asientos, plan de cuentas, DRE, balance.",
  },
  { codigo: "COMEX", nombre: "Comex", descripcion: "Procesos de importación, costos, despachos." },
  {
    codigo: "COMERCIAL_GESTOR",
    nombre: "Comercial gestor",
    descripcion: "Gestión de equipo comercial, aprobaciones comerciales.",
  },
  { codigo: "VENDEDOR", nombre: "Vendedor", descripcion: "Cartera propia, sin margen/costo." },
  { codigo: "INVENTARIO", nombre: "Estoque", descripcion: "Inventario, movimientos, conteo." },
  { codigo: "LOGISTICA", nombre: "Logística", descripcion: "Entregas, picking, expedición." },
  {
    codigo: "COMPRAS",
    nombre: "Compras",
    descripcion: "OC nacionales, cotizaciones, proveedores.",
  },
  { codigo: "CONSULTA", nombre: "Consulta", descripcion: "Solo lectura, sin datos sensibles." },
];

async function seedPerfilesCanonicos() {
  for (const p of PERFILES_CANONICOS) {
    await prisma.perfil.upsert({
      where: { codigo: p.codigo },
      update: {}, // no pisar ajustes del Master tras el primer seed
      create: {
        codigo: p.codigo,
        nombre: p.nombre,
        descripcion: p.descripcion,
        esSistema: false,
        activo: true,
      },
    });
  }
  console.log(
    `✓ ${PERFILES_CANONICOS.length} perfiles canónicos (shells sin grants) creados/actualizados`,
  );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("🌱 Iniciando seed (skeleton + analíticas base)...\n");
  await seedAdmin();
  await seedRbacFoundation();
  await seedPerfilesCanonicos();
  await seedPeriodos();
  await seedPlanDeCuentas();
  await seedDepositos();
  await seedPipelineStages();
  await seedProvinciasYJurisdicciones();
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
