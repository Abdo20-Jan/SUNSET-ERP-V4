import "server-only";

import { getBalanceSumasYSaldos } from "./balance-sumas-saldos";
import {
  buscarSaldoRazon,
  compararSaldo,
  type LineaReconciliacion,
  sumarSaldosSubledger,
} from "./bi-reconciliacion-formulas";
import { getCuentasACobrar } from "./cuentas-a-cobrar";
import { getCuentasAPagar } from "./cuentas-a-pagar";
import { PREFIJO_CLIENTES, PREFIJO_PROVEEDORES_LOCAL } from "./prefijos-plan";

// Controle de qualidade do BI: o saldo da sintética de controle no RAZÃO deve
// bater com a soma do SUBLEDGER. Pré-condição para confiar nos KPIs de CxC/CxP
// (DSO/DPO, já em prod). Reusa os mesmos services da aba Resumen / relatórios →
// reconcilia 1:1. Code-only; PROD tem 0 asientos → tudo aqui é estrutural.
//
// Código da sintética de controle = prefixo sem o ponto final (ref simbólica de
// prefijos-plan.ts, nunca literal): clientes "1.1.3", proveedores "2.1.1.01".
const CODIGO_CONTROL_CLIENTES = PREFIJO_CLIENTES.slice(0, -1);
const CODIGO_CONTROL_PROVEEDORES = PREFIJO_PROVEEDORES_LOCAL.slice(0, -1);

export type ReconciliacionSubledger = {
  clientes: LineaReconciliacion;
  proveedores: LineaReconciliacion;
};

/**
 * Reconcilia razão ↔ subledger para clientes e proveedores comerciais.
 *
 * - clientes: razão da sintética 1.1.3 vs Σ saldo das rows `clientes` de
 *   `getCuentasACobrar` (NÃO `totalGeneral`, que inclui valores a cobrar 1.1.4.20).
 * - proveedores: razão da sintética 2.1.1.01 (comercial LOCAL) vs Σ saldo de
 *   `proveedoresComerciales` de `getCuentasAPagar`. A deuda do EXTERIOR
 *   (2.1.1.02/.03) é subledger à parte (`getSaldosExteriorPorProveedor`) e NÃO
 *   entra aqui — por isso reconcilia contra 2.1.1.01, não contra 2.1.1.
 *
 * Sem filtro de data → saldo final acumulado até hoje (igual ao Resumen).
 */
export async function getReconciliacionSubledger(): Promise<ReconciliacionSubledger> {
  const [balance, cxc, cxp] = await Promise.all([
    getBalanceSumasYSaldos({}),
    getCuentasACobrar(),
    getCuentasAPagar(),
  ]);

  const saldoRazonClientes = buscarSaldoRazon(balance.root, CODIGO_CONTROL_CLIENTES);
  const saldoRazonProveedores = buscarSaldoRazon(balance.root, CODIGO_CONTROL_PROVEEDORES);

  const saldoSubledgerClientes = sumarSaldosSubledger(cxc.clientes.map((r) => r.saldo));
  const saldoSubledgerProveedores = sumarSaldosSubledger(
    cxp.proveedoresComerciales.map((r) => r.saldo),
  );

  return {
    clientes: compararSaldo({
      rubro: "clientes",
      saldoRazon: saldoRazonClientes,
      saldoSubledger: saldoSubledgerClientes,
    }),
    proveedores: compararSaldo({
      rubro: "proveedores",
      saldoRazon: saldoRazonProveedores,
      saldoSubledger: saldoSubledgerProveedores,
    }),
  };
}
