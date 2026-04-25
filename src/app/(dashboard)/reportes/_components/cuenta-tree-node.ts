import type { CuentaCategoria, CuentaTipo } from "@/generated/prisma/client";

export type SerializedTreeNode = {
  id: number;
  codigo: string;
  nombre: string;
  tipo: CuentaTipo;
  categoria: CuentaCategoria;
  nivel: number;
  debe: string;
  haber: string;
  saldo: string;
  children: SerializedTreeNode[];
};

export function serializeTreeNode(node: {
  id: number;
  codigo: string;
  nombre: string;
  tipo: CuentaTipo;
  categoria: CuentaCategoria;
  nivel: number;
  debe: { toFixed: (n: number) => string };
  haber: { toFixed: (n: number) => string };
  saldo: { toFixed: (n: number) => string };
  children: Parameters<typeof serializeTreeNode>[0][];
}): SerializedTreeNode {
  return {
    id: node.id,
    codigo: node.codigo,
    nombre: node.nombre,
    tipo: node.tipo,
    categoria: node.categoria,
    nivel: node.nivel,
    debe: node.debe.toFixed(2),
    haber: node.haber.toFixed(2),
    saldo: node.saldo.toFixed(2),
    children: node.children.map(serializeTreeNode),
  };
}
