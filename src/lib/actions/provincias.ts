"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// ============================================================
// PERCEPCIÓN IIBB INFO (preview client-side)
// ============================================================

// Devuelve el factor de Percepción IIBB que aplica para un cliente,
// para que el form de venda pueda mostrar el monto antes de guardar.
// Factor = alícuota / 100 (decimal). Si el cliente es exento, no
// tiene provincia, o la jurisdicción no es agente, retorna 0.
export type PercepcionInfo = {
  factor: string; // "0.03" si 3%; "0" si no aplica
  alicuota: string | null; // "3.0000" para mostrar al usuario
  jurisdiccionNombre: string | null;
};

export async function obtenerPercepcionInfoCliente(clienteId: string): Promise<PercepcionInfo> {
  const cliente = await db.cliente.findUnique({
    where: { id: clienteId },
    select: {
      exentoPercepcionIIBB: true,
      alicuotaPercepcionIIBB: true,
      provincia: {
        select: {
          jurisdiccionIIBB: {
            select: {
              esAgentePercepcion: true,
              alicuotaPercepcion: true,
              nombre: true,
            },
          },
        },
      },
    },
  });
  if (!cliente || cliente.exentoPercepcionIIBB) {
    return { factor: "0", alicuota: null, jurisdiccionNombre: null };
  }
  const jur = cliente.provincia?.jurisdiccionIIBB;
  if (!jur || !jur.esAgentePercepcion) {
    return { factor: "0", alicuota: null, jurisdiccionNombre: null };
  }
  const alicuota = (cliente.alicuotaPercepcionIIBB ?? jur.alicuotaPercepcion).toString();
  const factor = (Number(alicuota) / 100).toFixed(6);
  return {
    factor,
    alicuota,
    jurisdiccionNombre: jur.nombre,
  };
}

// Provincias são populadas via seed (24 entradas fixas AR). Não há
// CRUD para criar/deletar — apenas listar e (no futuro) atualizar
// nome/codigoAfip se necessário.
export type ProvinciaRow = {
  id: number;
  codigo: string;
  nombre: string;
  codigoAfip: string | null;
};

export async function listarProvincias(): Promise<ProvinciaRow[]> {
  const rows = await db.provincia.findMany({
    orderBy: { nombre: "asc" },
    select: { id: true, codigo: true, nombre: true, codigoAfip: true },
  });
  return rows;
}

// Localidad — CRUD on-demand pelo form de Cliente
export type LocalidadRow = {
  id: number;
  nombre: string;
  provinciaId: number;
};

export async function listarLocalidadesPorProvincia(provinciaId: number): Promise<LocalidadRow[]> {
  const rows = await db.localidad.findMany({
    where: { provinciaId },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, provinciaId: true },
  });
  return rows;
}

const localidadCreateSchema = z.object({
  provinciaId: z.number().int().positive(),
  nombre: z.string().trim().min(2).max(120),
});

export async function crearLocalidadAction(
  input: z.infer<typeof localidadCreateSchema>,
): Promise<{ ok: true; row: LocalidadRow } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autenticado" };

  const parsed = localidadCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  try {
    const row = await db.localidad.create({
      data: {
        provinciaId: parsed.data.provinciaId,
        nombre: parsed.data.nombre,
      },
      select: { id: true, nombre: true, provinciaId: true },
    });
    revalidatePath("/maestros/clientes");
    return { ok: true, row };
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { ok: false, error: "Ya existe una localidad con ese nombre en la provincia" };
    }
    return { ok: false, error: "Error al crear localidad" };
  }
}

// Codigo Postal — CRUD on-demand pelo form de Cliente
export type CodigoPostalRow = {
  id: number;
  cp: string;
  localidadId: number;
};

export async function listarCPsPorLocalidad(localidadId: number): Promise<CodigoPostalRow[]> {
  const rows = await db.codigoPostal.findMany({
    where: { localidadId },
    orderBy: { cp: "asc" },
    select: { id: true, cp: true, localidadId: true },
  });
  return rows;
}

const cpCreateSchema = z.object({
  localidadId: z.number().int().positive(),
  cp: z.string().trim().min(3).max(10),
});

export async function crearCPAction(
  input: z.infer<typeof cpCreateSchema>,
): Promise<{ ok: true; row: CodigoPostalRow } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autenticado" };

  const parsed = cpCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido" };
  }

  try {
    const row = await db.codigoPostal.create({
      data: {
        localidadId: parsed.data.localidadId,
        cp: parsed.data.cp.toUpperCase(),
      },
      select: { id: true, cp: true, localidadId: true },
    });
    revalidatePath("/maestros/clientes");
    return { ok: true, row };
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { ok: false, error: "Ya existe ese CP en la localidad" };
    }
    return { ok: false, error: "Error al crear código postal" };
  }
}
