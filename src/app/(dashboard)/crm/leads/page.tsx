import Link from "next/link";

import { listarLeads } from "@/lib/actions/leads";
import { isCrmEnabled } from "@/lib/features";
import { LeadEstado, LeadFuente } from "@/generated/prisma/client";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";

import { LeadsFilterBar } from "./_components/leads-filter-bar";
import { LeadsTableBulk } from "./_components/leads-table-bulk";

type SearchParams = Promise<{
  estado?: string;
  fuente?: string;
  q?: string;
  page?: string;
  perPage?: string;
}>;

function parseEstado(v: string | undefined): LeadEstado | undefined {
  if (!v) return undefined;
  return (Object.values(LeadEstado) as string[]).includes(v) ? (v as LeadEstado) : undefined;
}

function parseFuente(v: string | undefined): LeadFuente | undefined {
  if (!v) return undefined;
  return (Object.values(LeadFuente) as string[]).includes(v) ? (v as LeadFuente) : undefined;
}

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const params = await searchParams;
  const { estado, fuente, q } = params;
  const { page, perPage } = parsePaginationParams(params);

  const { rows, total } = await listarLeads({
    estado: parseEstado(estado),
    fuente: parseFuente(fuente),
    search: q,
    page,
    perPage,
  });

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} lead(s)</p>
        </div>
        <div className="flex gap-2">
          <Link href="/crm/leads/import" className="rounded-md border px-4 py-2 hover:bg-muted">
            Importar CSV
          </Link>
          <Link
            href="/crm/leads/nuevo"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Nuevo lead
          </Link>
        </div>
      </header>

      <LeadsFilterBar q={q} estado={estado} fuente={fuente} />

      {total === 0 ? (
        <p className="text-muted-foreground">No hay leads.</p>
      ) : (
        <>
          <LeadsTableBulk leads={rows} />
          <Pagination page={page} perPage={perPage} total={total} />
        </>
      )}
    </main>
  );
}
