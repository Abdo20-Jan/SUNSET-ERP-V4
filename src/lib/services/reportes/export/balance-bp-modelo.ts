// Modelo de dados do export do Balanço Patrimonial (formato artesanal do dono),
// INDEPENDENTE do exceljs. Recebe o resultado já calculado do Balance General
// (saldos em ARS nativo + revaluación USD já somada) e o achata em blocos
// artesanais (PT), com coluna USD (= ARS ÷ TC de cierre) e ARS.

import { Decimal, sumMoney } from "@/lib/decimal";
import { convertirAUsd } from "@/lib/format";

import type { BalanceGeneralResult } from "../balance-general";
import type { CuentaTreeNode } from "../shared";
import type { DetalleEmbarqueBP } from "./balance-bp-detalle";
import type { ModeloDRE } from "./balance-bp-dre";
import {
  BLOQUES,
  type BloqueBP,
  type LadoBP,
  bloqueArtesanalDe,
  bloquesPorLado,
  tituloBloque,
} from "./bloques-bp";

export type LineaBP = {
  codigo: string;
  descripcion: string;
  // SALDO FINAL (data final) — fechamento.
  usd: string; // toFixed(2)
  ars: string; // toFixed(2)
  // SALDO INICIAL (data inicial) — abertura (saldo acumulado anterior a
  // fechaDesde; 0 quando o relatório é só "saldo al hasta"). A diferença
  // final − inicial é o movimento do período, exibido nas colunas do meio.
  usdInicial: string; // toFixed(2)
  arsInicial: string; // toFixed(2)
};

export type BloqueModelo = {
  key: BloqueBP;
  titulo: string;
  lineas: LineaBP[];
  subtotalUsd: string;
  subtotalArs: string;
  subtotalUsdInicial: string;
  subtotalArsInicial: string;
  // Detalhe por embarque (sub-linhas informativas; NÃO entram no subtotal nem
  // nos totais — preserva o cuadre contável). Ver balance-bp-detalle.ts.
  detalle?: DetalleEmbarqueBP[];
};

export type BalanceBPModelo = {
  fecha: string; // YYYY-MM-DD
  tc: string | null; // TC de cierre (ARS por USD) usado na coluna USD
  ativo: BloqueModelo[];
  pasivo: BloqueModelo[];
  pl: BloqueModelo[];
  totalAtivoUsd: string;
  totalAtivoArs: string;
  totalAtivoUsdInicial: string;
  totalAtivoArsInicial: string;
  totalPasivoUsd: string;
  totalPasivoArs: string;
  totalPasivoUsdInicial: string;
  totalPasivoArsInicial: string;
  totalPlUsd: string;
  totalPlArs: string;
  totalPlUsdInicial: string;
  totalPlArsInicial: string;
  // Datas do cabeçalho: inicial (abertura) e final (fechamento).
  fechaInicial: string | null; // YYYY-MM-DD ou null (só "saldo al hasta")
  fechaFinal: string; // YYYY-MM-DD
  checkUsd: string; // ATIVO − (PASIVO + PL); 0 quando cuadra
  checkArs: string;
  cuadra: boolean;
  // Bloco "Conferindo o DRE" (cascata RT9 + impostos AR), opcional. `dreCheck*`
  // = RESULTADO do DRE − RESULTADO do PL; 0 por construção (mesma fonte).
  dre?: ModeloDRE & { checkArs: string; checkUsd: string };
};

// Campos do BalanceGeneralResult realmente consumidos (Pick mantém o helper
// testável com fixtures mínimas).
type BalanceInput = Pick<
  BalanceGeneralResult,
  | "activo"
  | "pasivo"
  | "patrimonio"
  | "totalActivo"
  | "totalPasivo"
  | "totalPatrimonioAjustado"
  | "totalSaldoInicialActivo"
  | "totalSaldoInicialPasivo"
  | "totalSaldoInicialPatrimonio"
  | "resultadoEjercicio"
  | "cuadra"
  | "diferencia"
>;

function recolectarHojas(nodes: CuentaTreeNode[]): CuentaTreeNode[] {
  const out: CuentaTreeNode[] = [];
  for (const n of nodes) {
    if (n.children.length === 0) out.push(n);
    else out.push(...recolectarHojas(n.children));
  }
  return out;
}

function linea(
  codigo: string,
  descripcion: string,
  saldoArs: Decimal,
  saldoInicialArs: Decimal,
  tc: string | null,
): LineaBP {
  const ars = saldoArs.toFixed(2);
  const arsInicial = saldoInicialArs.toFixed(2);
  return {
    codigo,
    descripcion,
    ars,
    usd: convertirAUsd(ars, tc),
    arsInicial,
    usdInicial: convertirAUsd(arsInicial, tc),
  };
}

function construirLado(nodes: CuentaTreeNode[], lado: LadoBP, tc: string | null): BloqueModelo[] {
  const porBloque = new Map<BloqueBP, CuentaTreeNode[]>();
  for (const hoja of recolectarHojas(nodes)) {
    const key = bloqueArtesanalDe(hoja.rubroEECC, hoja.codigo, lado);
    const arr = porBloque.get(key) ?? [];
    arr.push(hoja);
    porBloque.set(key, arr);
  }

  const modelos: BloqueModelo[] = [];
  for (const def of bloquesPorLado(lado)) {
    const hojas = (porBloque.get(def.key) ?? []).filter((h) => !h.saldo.isZero());
    if (hojas.length === 0) continue; // não emite bloco vazio (v1)
    const lineas = hojas.map((h) => linea(h.codigo, h.nombre, h.saldo, h.saldoInicial, tc));
    const subtotalArs = sumMoney(hojas.map((h) => h.saldo)).toFixed(2);
    const subtotalArsInicial = sumMoney(hojas.map((h) => h.saldoInicial)).toFixed(2);
    modelos.push({
      key: def.key,
      titulo: def.titulo,
      lineas,
      subtotalArs,
      subtotalUsd: convertirAUsd(subtotalArs, tc),
      subtotalArsInicial,
      subtotalUsdInicial: convertirAUsd(subtotalArsInicial, tc),
    });
  }
  return modelos;
}

// Ordem canônica dos blocos (= BLOQUES) para reinserir um bloco criado só pelo
// detalhe (sem hojas contáveis) na posição certa de liquidez.
const ORDEN_BLOQUE = new Map(BLOQUES.map((b, i) => [b.key, i]));

// Anexa o detalhe por embarque a um bloco. Se o bloco não existir (sem saldo
// contável mas com embarques), cria-o com subtotal 0 e reordena — o detalhe é
// informativo e nunca toca subtotais/totais.
function adjuntarDetalle(
  bloques: BloqueModelo[],
  key: BloqueBP,
  detalle: DetalleEmbarqueBP[] | undefined,
  tc: string | null,
): void {
  if (!detalle || detalle.length === 0) return;
  const blk = bloques.find((b) => b.key === key);
  if (blk) {
    blk.detalle = detalle;
    return;
  }
  bloques.push({
    key,
    titulo: tituloBloque(key),
    lineas: [],
    subtotalArs: "0.00",
    subtotalUsd: convertirAUsd("0.00", tc),
    subtotalArsInicial: "0.00",
    subtotalUsdInicial: convertirAUsd("0.00", tc),
    detalle,
  });
  bloques.sort((a, b) => (ORDEN_BLOQUE.get(a.key) ?? 0) - (ORDEN_BLOQUE.get(b.key) ?? 0));
}

export function construirModeloBP(
  bg: BalanceInput,
  opts: {
    tc: string | null;
    fecha: string; // data final (fechaHasta) — fechamento
    fechaInicial?: string | null; // data inicial (fechaDesde) — abertura
    // Sub-linhas por embarque (lado passivo / ativo). Mapeadas pela rota a
    // partir de getSaldosExteriorPorProveedor / getStockEnTransitoPorEmbarque.
    detalleExterior?: DetalleEmbarqueBP[];
    detalleStockTransito?: DetalleEmbarqueBP[];
    // Bloco "Conferindo o DRE" (cascata RT9 + impostos), construído pela rota
    // via construirModeloDRE. A conferência ▲ vs o RESULTADO do PL é calculada aqui.
    dre?: ModeloDRE;
  },
): BalanceBPModelo {
  const { tc, fecha } = opts;

  const ativo = construirLado(bg.activo, "ATIVO", tc);
  const pasivo = construirLado(bg.pasivo, "PASIVO", tc);
  const pl = construirLado(bg.patrimonio, "PL", tc);

  // RESULTADO DEL EJERCICIO: vem do Estado de Resultados (não é uma hoja da
  // árvore patrimonial). Soma-se ao PL para que o total bata com o ajustado.
  if (!bg.resultadoEjercicio.isZero()) {
    // Resultado é movimento do período → saldo inicial 0 (aparece como
    // movimento entre data inicial e data final).
    const ln = linea("3.4", "RESULTADO DEL EJERCICIO", bg.resultadoEjercicio, new Decimal(0), tc);
    let blk = pl.find((b) => b.key === "PATRIMONIO_LIQUIDO");
    if (!blk) {
      blk = {
        key: "PATRIMONIO_LIQUIDO",
        titulo: "PATRIMONIO LÍQUIDO",
        lineas: [],
        subtotalArs: "0.00",
        subtotalUsd: convertirAUsd("0.00", tc),
        subtotalArsInicial: "0.00",
        subtotalUsdInicial: convertirAUsd("0.00", tc),
      };
      pl.push(blk);
    }
    blk.lineas.push(ln);
    const sub = sumMoney([new Decimal(blk.subtotalArs), bg.resultadoEjercicio]).toFixed(2);
    blk.subtotalArs = sub;
    blk.subtotalUsd = convertirAUsd(sub, tc);
  }

  // Detalhe por embarque (PR2): PROVEDORES DO EXTERIOR (passivo) + STOCK em
  // trânsito (ativo). Aditivo/informativo — não altera subtotais nem totais.
  adjuntarDetalle(pasivo, "PROVEDORES_EXTERIOR", opts.detalleExterior, tc);
  adjuntarDetalle(ativo, "STOCK", opts.detalleStockTransito, tc);

  const totalAtivoArs = bg.totalActivo.toFixed(2);
  const totalPasivoArs = bg.totalPasivo.toFixed(2);
  const totalPlArs = bg.totalPatrimonioAjustado.toFixed(2);
  const totalAtivoArsInicial = bg.totalSaldoInicialActivo.toFixed(2);
  const totalPasivoArsInicial = bg.totalSaldoInicialPasivo.toFixed(2);
  const totalPlArsInicial = bg.totalSaldoInicialPatrimonio.toFixed(2);
  const checkArs = bg.diferencia.toFixed(2);

  // Bloco DRE (opcional): conferência ▲ = RESULTADO do DRE − RESULTADO do PL.
  // Por construção é 0 (ambos = Σ(haber−debe) do razão); a linha prova isso.
  let dre: BalanceBPModelo["dre"];
  if (opts.dre) {
    const dreCheckArs = new Decimal(opts.dre.resultadoArs).minus(bg.resultadoEjercicio).toFixed(2);
    dre = { ...opts.dre, checkArs: dreCheckArs, checkUsd: convertirAUsd(dreCheckArs, tc) };
  }

  return {
    fecha,
    tc,
    fechaInicial: opts.fechaInicial ?? null,
    fechaFinal: fecha,
    ativo,
    pasivo,
    pl,
    totalAtivoArs,
    totalAtivoUsd: convertirAUsd(totalAtivoArs, tc),
    totalAtivoArsInicial,
    totalAtivoUsdInicial: convertirAUsd(totalAtivoArsInicial, tc),
    totalPasivoArs,
    totalPasivoUsd: convertirAUsd(totalPasivoArs, tc),
    totalPasivoArsInicial,
    totalPasivoUsdInicial: convertirAUsd(totalPasivoArsInicial, tc),
    totalPlArs,
    totalPlUsd: convertirAUsd(totalPlArs, tc),
    totalPlArsInicial,
    totalPlUsdInicial: convertirAUsd(totalPlArsInicial, tc),
    checkArs,
    checkUsd: convertirAUsd(checkArs, tc),
    cuadra: bg.cuadra,
    dre,
  };
}
