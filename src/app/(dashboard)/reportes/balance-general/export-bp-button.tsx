import { buttonVariants } from "@/components/ui/button";

// Botão "Exportar a Excel" do Balance General. Server component: é apenas um
// link de download para a rota /api/reportes/balance-general/export, propagando
// o filtro de fechas atual. A moeda não altera o conteúdo (o .xlsx traz sempre
// USD + ARS ao TC de cierre), mas é propagada por consistência.
export function ExportBPButton({
  desde,
  hasta,
  moneda,
}: {
  desde: string;
  hasta: string;
  moneda: string;
}) {
  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);
  qs.set("moneda", moneda);

  return (
    <a
      href={`/api/reportes/balance-general/export?${qs.toString()}`}
      download
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      Exportar a Excel
    </a>
  );
}
