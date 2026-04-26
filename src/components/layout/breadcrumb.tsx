import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

type Crumb = {
  label: string;
  href?: string;
};

/**
 * Breadcrumb simple para páginas de detail.
 * Ej: <Breadcrumb crumbs={[{label:"Comex", href:"/comex"}, {label:"Embarques", href:"/comex/embarques"}, {label:"AR-001"}]} />
 */
export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav
      aria-label="breadcrumb"
      className="flex items-center gap-1 text-xs text-muted-foreground"
    >
      {crumbs.map((c, idx) => {
        const isLast = idx === crumbs.length - 1;
        return (
          <span key={`${c.label}-${idx}`} className="flex items-center gap-1">
            {c.href && !isLast ? (
              <Link
                href={c.href}
                className="hover:text-foreground hover:underline underline-offset-4"
              >
                {c.label}
              </Link>
            ) : (
              <span
                className={isLast ? "font-medium text-foreground" : undefined}
                aria-current={isLast ? "page" : undefined}
              >
                {c.label}
              </span>
            )}
            {!isLast && (
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3 opacity-50"
              />
            )}
          </span>
        );
      })}
    </nav>
  );
}
