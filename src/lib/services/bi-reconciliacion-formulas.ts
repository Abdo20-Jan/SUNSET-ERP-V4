/**
 * Fórmulas PURAS de reconciliação razão ↔ subledger (F0-DAT-5). Sem acesso à
 * base nem a `server-only`: testáveis isoladamente.
 *
 * Controle de qualidade: o saldo da conta de controle no RAZÃO (sintética de
 * clientes 1.1.3 / proveedores comerciais 2.1.1.01) deve bater com a soma do
 * SUBLEDGER correspondente (CxC / CxP), dentro de tolerância sub-centavo.
 *
 * Convenção de sinal: ambos os lados usam saldo NATURAL positivo — clientes
 * (ATIVO→DEUDOR) e proveedores (PASSIVO→ACREEDOR) expõem saldo positivo, igual
 * a `CxCRow.saldo` / `CxPRow.saldo`. A comparação é direta (razão − subledger).
 */

export type RubroReconciliacion = "clientes" | "proveedores";

export type LineaReconciliacion = {
  rubro: RubroReconciliacion;
  /** Saldo da sintética de controle no razão (saldo final acumulado). */
  saldoRazon: number;
  /** Soma dos saldos das contas analíticas do subledger. */
  saldoSubledger: number;
  /** razão − subledger (positivo = razão maior que o subledger). */
  diferencia: number;
  /** true quando |diferencia| < TOLERANCIA_RECONCILIACION. */
  ok: boolean;
};

/** Shape mínimo de um nó da árvore do balance (compatível com `BalanceNode`). */
export type NodoBalanceReconciliable = {
  codigo: string;
  saldoFinal: string;
  children?: NodoBalanceReconciliable[];
};

/** Tolerância sub-centavo: ruído de arredondamento abaixo disso é "ok". */
export const TOLERANCIA_RECONCILIACION = 0.005;

/** Limpa ruído de ponto flutuante (0.1+0.2…) sem perder precisão sub-centavo. */
function redondear4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Soma saldos de subledger vindos como string. Parse seguro: valores não
 * finitos (vazio / lixo) contam 0. Lista vazia → 0.
 */
export function sumarSaldosSubledger(saldos: string[]): number {
  let total = 0;
  for (const s of saldos) {
    const n = Number.parseFloat(s);
    if (Number.isFinite(n)) total += n;
  }
  return redondear4(total);
}

/** Busca recursiva por código numa árvore de nós do balance. null se ausente. */
export function buscarNodoPorCodigo(
  nodes: NodoBalanceReconciliable[],
  codigo: string,
): NodoBalanceReconciliable | null {
  for (const n of nodes) {
    if (n.codigo === codigo) return n;
    if (n.children?.length) {
      const encontrado = buscarNodoPorCodigo(n.children, codigo);
      if (encontrado) return encontrado;
    }
  }
  return null;
}

/**
 * Saldo da sintética de controle no razão. Tolera nó ausente (pós-wipe / conta
 * sem movimento) retornando 0 — nunca lança. `saldoFinal` não finito → 0.
 */
export function buscarSaldoRazon(nodes: NodoBalanceReconciliable[], codigo: string): number {
  const nodo = buscarNodoPorCodigo(nodes, codigo);
  if (!nodo) return 0;
  const n = Number.parseFloat(nodo.saldoFinal);
  return Number.isFinite(n) ? redondear4(n) : 0;
}

/** Compara o saldo do razão com o do subledger e classifica dentro da tolerância. */
export function compararSaldo(input: {
  rubro: RubroReconciliacion;
  saldoRazon: number;
  saldoSubledger: number;
}): LineaReconciliacion {
  const diferencia = redondear4(input.saldoRazon - input.saldoSubledger);
  return {
    rubro: input.rubro,
    saldoRazon: input.saldoRazon,
    saldoSubledger: input.saldoSubledger,
    diferencia,
    ok: Math.abs(diferencia) < TOLERANCIA_RECONCILIACION,
  };
}
