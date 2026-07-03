/**
 * Helpers puros client-safe del árbol del Plan de Cuentas (CONT-02 · PR-028):
 * búsqueda con auto-expansión (Q&A estructural 4 — 3+ caracteres) y
 * [Expandir hasta nivel N] (Q&A 3). Sin Prisma, sin efectos — testables.
 */

export type ArbolNode = {
  codigo: string;
  nombre: string;
  children?: ArbolNode[];
};

export const BUSQUEDA_MIN_CHARS = 3;

function matchesTermino(node: ArbolNode, term: string): boolean {
  return node.codigo.toLowerCase().includes(term) || node.nombre.toLowerCase().includes(term);
}

/**
 * Poda el árbol manteniendo los matches (código o nombre, case-insensitive)
 * y sus ANCESTROS. Un nodo que matchea conserva su subárbol completo (el
 * usuario puede seguir explorando debajo del match). Con menos de 3
 * caracteres devuelve las raíces intactas (autocomplete de la spec).
 */
export function filtrarArbol<T extends ArbolNode>(roots: T[], termino: string): T[] {
  const term = termino.trim().toLowerCase();
  if (term.length < BUSQUEDA_MIN_CHARS) return roots;

  const filtrarNodo = (node: T): T | null => {
    if (matchesTermino(node, term)) return node;
    const children = (node.children ?? []) as T[];
    const vivos = children.map(filtrarNodo).filter((n): n is T => n !== null);
    if (vivos.length === 0) return null;
    return { ...node, children: vivos };
  };

  return roots.map(filtrarNodo).filter((n): n is T => n !== null);
}

/**
 * ExpandedState (keyed por `codigo` — el `getRowId` del árbol) que expande
 * los nodos con profundidad < n (n=1 muestra sólo las raíces expandidas).
 */
export function expandedHastaNivel(roots: ArbolNode[], n: number): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  const walk = (node: ArbolNode, depth: number) => {
    if (depth < n && node.children && node.children.length > 0) {
      expanded[node.codigo] = true;
    }
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return expanded;
}

/** ExpandedState que expande TODO el árbol (usado durante la búsqueda). */
export function expandedTodo(roots: ArbolNode[]): Record<string, boolean> {
  return expandedHastaNivel(roots, Number.MAX_SAFE_INTEGER);
}
