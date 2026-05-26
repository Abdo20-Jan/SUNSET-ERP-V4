/**
 * Diagnóstico read-only: por qué las facturas de TP LOGISTICA siguen
 * pendientes en /tesoreria/cuentas-a-pagar a pesar de los pagos #29 y #34
 * de enero/2026.
 *
 * Reproduce los 3 layers del algoritmo getSaldosPorProveedorConAging
 * (src/lib/services/cuentas-a-pagar.ts) para identificar qué layer falla
 * y por qué (Cenário A: cobertura < 98%, B: HABER reduce neto, C: cadastros
 * duplicados con cuentas distintas).
 */

import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const COBERTURA_MINIMA = 0.98;
const TOKENS_GENERICOS = new Set(["Factura", "factura", "Pago", "pago"]);
const EMBARQUE_CODIGO_OBJETIVO = "AR-250827-016CN";

function fmt(d: Decimal | string | number): string {
  return new Decimal(d).toFixed(2);
}

function tokensDescripcion(desc: string | null): Set<string> {
  if (!desc) return new Set();
  return new Set(desc.split(/[\s—,;]+/).filter((t) => t.length > 0));
}

async function main() {
  // ============================================================
  // 1. Identificar cadastros de proveedor "TP LOGISTICA"
  // ============================================================
  const proveedores = await prisma.proveedor.findMany({
    where: { nombre: { contains: "TP LOGISTICA", mode: "insensitive" } },
    select: {
      id: true,
      nombre: true,
      cuit: true,
      tipoProveedor: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
    },
    orderBy: { nombre: "asc" },
  });

  console.log("=== 1. CADASTROS DE PROVEEDOR TP LOGISTICA ===");
  if (proveedores.length === 0) {
    console.log("  (ningún proveedor con nombre conteniendo 'TP LOGISTICA')");
    return;
  }
  for (const p of proveedores) {
    console.log(
      `  ${p.nombre.padEnd(40)} | id=${p.id.slice(0, 8)} | cuit=${p.cuit ?? "—"} | tipo=${p.tipoProveedor} | cta=${p.cuentaContable?.codigo ?? "—"} (${p.cuentaContable?.nombre ?? "—"})`,
    );
  }
  console.log("");

  const proveedorById = new Map(proveedores.map((p) => [p.id, p]));
  const cuentaIds = Array.from(
    new Set(proveedores.map((p) => p.cuentaContableId).filter((id): id is number => id !== null)),
  );

  // ============================================================
  // 2. Saldo contable real por cuenta del proveedor
  // ============================================================
  console.log("=== 2. SALDO CONTABLE REAL (haber - debe) POR CUENTA ===");
  const sums = await prisma.lineaAsiento.groupBy({
    by: ["cuentaId"],
    where: {
      cuentaId: { in: cuentaIds },
      asiento: { estado: "CONTABILIZADO" },
    },
    _sum: { debe: true, haber: true },
  });
  const cuentaInfo = await prisma.cuentaContable.findMany({
    where: { id: { in: cuentaIds } },
    select: { id: true, codigo: true, nombre: true },
  });
  const cuentaById = new Map(cuentaInfo.map((c) => [c.id, c]));
  const saldoPorCuenta = new Map<number, Decimal>();
  for (const s of sums) {
    const haber = new Decimal(s._sum.haber ?? 0);
    const debe = new Decimal(s._sum.debe ?? 0);
    const saldo = haber.minus(debe);
    saldoPorCuenta.set(s.cuentaId, saldo);
    const c = cuentaById.get(s.cuentaId)!;
    console.log(
      `  ${c.codigo} (${c.nombre.padEnd(35)}) | debe=${fmt(debe).padStart(18)} | haber=${fmt(haber).padStart(18)} | saldo=${fmt(saldo).padStart(18)} ARS`,
    );
  }
  console.log("");

  // ============================================================
  // 3. EmbarqueCostos de TP LOGISTICA con embarque CERRADO
  // ============================================================
  const proveedorIds = proveedores.map((p) => p.id);
  const costos = await prisma.embarqueCosto.findMany({
    where: {
      proveedorId: { in: proveedorIds },
      embarque: { estado: "CERRADO" },
    },
    select: {
      id: true,
      facturaNumero: true,
      fechaFactura: true,
      tipoCambio: true,
      moneda: true,
      iva: true,
      iibb: true,
      otros: true,
      proveedorId: true,
      lineas: { select: { subtotal: true } },
      embarque: { select: { codigo: true } },
    },
    orderBy: [{ fechaFactura: "asc" }, { id: "asc" }],
  });

  console.log(
    `=== 3. EMBARQUE COSTOS DE TP LOGISTICA (embarque CERRADO) — ${costos.length} encontrados ===`,
  );
  type CostoCalc = {
    id: number;
    facturaNumero: string | null;
    fechaFactura: Date | null;
    embarqueCodigo: string;
    proveedorId: string;
    totalArs: Decimal;
  };
  const costosCalc: CostoCalc[] = costos.map((c) => {
    const subtotal = c.lineas.reduce((acc, l) => acc.plus(new Decimal(l.subtotal)), new Decimal(0));
    const totalMoneda = subtotal
      .plus(new Decimal(c.iva))
      .plus(new Decimal(c.iibb))
      .plus(new Decimal(c.otros));
    const totalArs = totalMoneda.times(new Decimal(c.tipoCambio));
    return {
      id: c.id,
      facturaNumero: c.facturaNumero,
      fechaFactura: c.fechaFactura,
      embarqueCodigo: c.embarque.codigo,
      proveedorId: c.proveedorId,
      totalArs,
    };
  });
  for (const c of costosCalc) {
    const prov = proveedorById.get(c.proveedorId);
    console.log(
      `  embarque=${c.embarqueCodigo.padEnd(20)} | fact=${(c.facturaNumero ?? "—").padEnd(18)} | fecha=${c.fechaFactura?.toISOString().slice(0, 10) ?? "—"} | total=${fmt(c.totalArs).padStart(16)} ARS | proveedor=${prov?.nombre}`,
    );
  }
  console.log("");

  // ============================================================
  // 4. Asientos contabilizados que tocan las cuentas de TP LOGISTICA
  //    Filtra por descripción que mencione TP LOGISTICA, PAGO ARS, o pago múltiple
  // ============================================================
  const asientosCandidatos = await prisma.asiento.findMany({
    where: {
      estado: "CONTABILIZADO",
      lineas: { some: { cuentaId: { in: cuentaIds } } },
      OR: [
        { descripcion: { contains: "TP LOGISTICA", mode: "insensitive" } },
        { descripcion: { contains: "PAGO ARS", mode: "insensitive" } },
        { descripcion: { contains: "Pago múltiple", mode: "insensitive" } },
        { descripcion: { contains: EMBARQUE_CODIGO_OBJETIVO, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      numero: true,
      fecha: true,
      descripcion: true,
      lineas: {
        where: { cuentaId: { in: cuentaIds } },
        select: {
          cuentaId: true,
          debe: true,
          haber: true,
          descripcion: true,
        },
      },
    },
    orderBy: { fecha: "asc" },
  });

  console.log(
    `=== 4. ASIENTOS CANDIDATOS QUE TOCAN CUENTAS TP LOGISTICA — ${asientosCandidatos.length} ===`,
  );
  for (const a of asientosCandidatos) {
    console.log(`\n  Asiento #${a.numero} (${a.fecha.toISOString().slice(0, 10)})`);
    console.log(`    descripcion asiento: ${a.descripcion}`);
    for (const l of a.lineas) {
      const c = cuentaById.get(l.cuentaId);
      console.log(
        `    [cta ${c?.codigo}] DEBE=${fmt(l.debe).padStart(14)} HABER=${fmt(l.haber).padStart(14)} | desc='${l.descripcion ?? ""}'`,
      );
    }
  }
  console.log("");

  // ============================================================
  // 5. Construir pagosPorCuentaTokens (igual al algoritmo real)
  //    NETO = DEBE - HABER por (cuenta, asiento)
  //    Tokens = unión de tokens de las líneas DEBE (líneas HABER son
  //    genéricas tipo "Saldo pendiente").
  // ============================================================
  console.log("=== 5. PAGOS EFECTIVOS POR CUENTA (NETO DEBE-HABER por asiento) ===");
  const lineasTodas = await prisma.lineaAsiento.findMany({
    where: {
      cuentaId: { in: cuentaIds },
      asiento: { estado: "CONTABILIZADO" },
    },
    select: {
      cuentaId: true,
      asientoId: true,
      debe: true,
      haber: true,
      descripcion: true,
      asiento: { select: { numero: true, fecha: true } },
    },
  });

  type AsientoCuentaInfo = {
    cuentaId: number;
    asientoNumero: number;
    fecha: Date;
    neto: Decimal;
    tokens: Set<string>;
    descripciones: string[];
  };
  const porAsientoCuenta = new Map<string, AsientoCuentaInfo>();
  for (const l of lineasTodas) {
    const key = `${l.cuentaId}::${l.asientoId}`;
    let info = porAsientoCuenta.get(key);
    if (!info) {
      info = {
        cuentaId: l.cuentaId,
        asientoNumero: l.asiento.numero,
        fecha: l.asiento.fecha,
        neto: new Decimal(0),
        tokens: new Set(),
        descripciones: [],
      };
      porAsientoCuenta.set(key, info);
    }
    const debe = new Decimal(l.debe);
    const haber = new Decimal(l.haber);
    info.neto = info.neto.plus(debe).minus(haber);
    if (debe.gt(0)) {
      for (const t of tokensDescripcion(l.descripcion)) info.tokens.add(t);
      if (l.descripcion) info.descripciones.push(l.descripcion);
    }
  }

  const pagosPorCuenta = new Map<
    number,
    Array<{
      asientoNumero: number;
      fecha: Date;
      neto: Decimal;
      tokens: Set<string>;
      descripciones: string[];
    }>
  >();
  for (const info of porAsientoCuenta.values()) {
    if (info.neto.lte(0.005)) continue;
    const arr = pagosPorCuenta.get(info.cuentaId) ?? [];
    arr.push({
      asientoNumero: info.asientoNumero,
      fecha: info.fecha,
      neto: info.neto,
      tokens: info.tokens,
      descripciones: info.descripciones,
    });
    pagosPorCuenta.set(info.cuentaId, arr);
  }
  for (const [cuentaId, pagos] of pagosPorCuenta) {
    const c = cuentaById.get(cuentaId);
    console.log(`\n  Cuenta ${c?.codigo} (${c?.nombre}) — ${pagos.length} pagos efectivos:`);
    pagos.sort((a, b) => a.asientoNumero - b.asientoNumero);
    for (const p of pagos) {
      const hasEmbCode = p.tokens.has(EMBARQUE_CODIGO_OBJETIVO);
      console.log(
        `    #${p.asientoNumero} (${p.fecha.toISOString().slice(0, 10)}) | neto=${fmt(p.neto).padStart(14)} | tokens-relevantes: AR-...=${hasEmbCode ? "✓" : "✗"}`,
      );
      console.log(`      descs DEBE: ${p.descripciones.map((d) => `'${d}'`).join(" | ")}`);
    }
  }
  console.log("");

  // ============================================================
  // 6. Aplicar Layer 1 (número) + Layer 2 (embarque) + Layer 4 (FIFO sin ID)
  // ============================================================
  console.log("=== 6. VEREDICTO POR FACTURA (Layer 1 + Layer 2 + Layer 4) ===\n");

  function montoPagadoFactura(numero: string, cuentaId: number | null): Decimal {
    if (cuentaId === null) return new Decimal(0);
    const lineas = pagosPorCuenta.get(cuentaId);
    if (!lineas) return new Decimal(0);
    const numeroTokens = numero.split(/[\s—,;]+/).filter((t) => t.length > 0);
    if (numeroTokens.length === 0) return new Decimal(0);
    const tokensEspecificos = numeroTokens.filter((t) => !TOKENS_GENERICOS.has(t));
    if (tokensEspecificos.length === 0) return new Decimal(0);
    let pagado = new Decimal(0);
    for (const l of lineas) {
      const todosPresentes = numeroTokens.every((t) => l.tokens.has(t));
      if (todosPresentes) pagado = pagado.plus(l.neto);
    }
    return pagado;
  }

  function montoPagadoEmbarque(embarqueCodigo: string, cuentaId: number | null): Decimal {
    if (cuentaId === null) return new Decimal(0);
    const lineas = pagosPorCuenta.get(cuentaId);
    if (!lineas) return new Decimal(0);
    let pagado = new Decimal(0);
    for (const l of lineas) {
      if (l.tokens.has(embarqueCodigo)) pagado = pagado.plus(l.neto);
    }
    return pagado;
  }

  // Estructura por factura con los 3 layers calculados (replicando algoritmo)
  type FactCalc = {
    c: CostoCalc;
    layer1: Decimal;
    layer2: Decimal;
    layer4: Decimal;
  };
  const porProveedor = new Map<string, FactCalc[]>();
  for (const c of costosCalc) {
    const arr = porProveedor.get(c.proveedorId) ?? [];
    arr.push({ c, layer1: new Decimal(0), layer2: new Decimal(0), layer4: new Decimal(0) });
    porProveedor.set(c.proveedorId, arr);
  }

  for (const [proveedorId, facts] of porProveedor) {
    const prov = proveedorById.get(proveedorId)!;
    const cuentaId = prov.cuentaContableId;
    const cuenta = cuentaId !== null ? cuentaById.get(cuentaId) : null;

    console.log(`\n  Proveedor: '${prov.nombre}' | cta=${cuenta?.codigo ?? "—"}`);

    // Layer 1: número de factura
    for (const f of facts) {
      const numero = f.c.facturaNumero ?? `Factura #${f.c.id}`;
      f.layer1 = montoPagadoFactura(numero, cuentaId);
    }

    // Layer 2: código de embarque, threshold 98% por (proveedor, embarque)
    const porEmbarque = new Map<string, FactCalc[]>();
    for (const f of facts) {
      const arr = porEmbarque.get(f.c.embarqueCodigo) ?? [];
      arr.push(f);
      porEmbarque.set(f.c.embarqueCodigo, arr);
    }
    for (const [embCodigo, grupo] of porEmbarque) {
      const totalLayer1 = grupo.reduce((acc, x) => acc.plus(x.layer1), new Decimal(0));
      const pagoEmbarqueTotal = montoPagadoEmbarque(embCodigo, cuentaId);
      const pagoExtra = pagoEmbarqueTotal.minus(totalLayer1);
      const totalPendGrupo = grupo.reduce(
        (acc, x) => acc.plus(x.c.totalArs.minus(x.layer1)),
        new Decimal(0),
      );
      const cobertura = totalPendGrupo.gt(0) ? pagoExtra.div(totalPendGrupo).toNumber() : 0;
      const zerar = pagoExtra.gt(0.005) && cobertura >= COBERTURA_MINIMA;
      console.log(
        `    [L2] embarque=${embCodigo} | pagoExtra=${fmt(pagoExtra)} | pend=${fmt(totalPendGrupo)} | cobertura=${(cobertura * 100).toFixed(2)}% ${zerar ? "✓" : "✗"}`,
      );
      if (zerar) {
        for (const f of grupo) f.layer2 = f.c.totalArs.minus(f.layer1);
      }
    }

    // Layer 4: FIFO sobre pagos no atribuidos (orden cronológico)
    const pagos = pagosPorCuenta.get(cuentaId ?? -1) ?? [];
    const pagoTotalCuenta = pagos.reduce((acc, l) => acc.plus(l.neto), new Decimal(0));
    const pagoAtribuido = facts.reduce(
      (acc, f) => acc.plus(f.layer1).plus(f.layer2),
      new Decimal(0),
    );
    let pagoNoAtribuido = pagoTotalCuenta.minus(pagoAtribuido);
    console.log(
      `    [L4] pagoTotalCta=${fmt(pagoTotalCuenta)} | pagoAtribuido(L1+L2)=${fmt(pagoAtribuido)} | pagoNoAtribuido=${fmt(pagoNoAtribuido)}`,
    );
    const ordenadas = [...facts].sort((a, b) =>
      (a.c.fechaFactura?.toISOString() ?? "").localeCompare(b.c.fechaFactura?.toISOString() ?? ""),
    );
    for (const f of ordenadas) {
      if (pagoNoAtribuido.lte(0.005)) break;
      const pendFact = f.c.totalArs.minus(f.layer1).minus(f.layer2);
      if (pendFact.lte(0.005)) continue;
      const tomar = pendFact.gt(pagoNoAtribuido) ? pagoNoAtribuido : pendFact;
      f.layer4 = tomar;
      pagoNoAtribuido = pagoNoAtribuido.minus(tomar);
    }

    // Veredicto por factura
    for (const f of facts) {
      const pendiente = f.c.totalArs.minus(f.layer1).minus(f.layer2).minus(f.layer4);
      const flag = pendiente.gt(0.5) ? "PENDIENTE" : "OK";
      console.log(
        `      [${flag.padEnd(9)}] fact=${(f.c.facturaNumero ?? "—").padEnd(18)} total=${fmt(f.c.totalArs).padStart(14)} | L1=${fmt(f.layer1).padStart(12)} L2=${fmt(f.layer2).padStart(12)} L4=${fmt(f.layer4).padStart(12)} | pend=${fmt(pendiente).padStart(14)}`,
      );
    }
  }

  console.log("\n=== FIN DIAGNÓSTICO ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
