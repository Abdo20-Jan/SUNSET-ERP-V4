import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Header padrão de página: título + descrição opcional + slot de ações.
 * Densidade: h1 text-[15px] (não 2xl), description text-xs.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border/60 pb-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="font-heading text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}
