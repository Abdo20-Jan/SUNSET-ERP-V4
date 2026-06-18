"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Menu01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CENTERS } from "@/components/layout/nav-config";

export function NavDrawer() {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Menú" />}
      >
        <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="p-4 pb-2">
          <SheetTitle>Navegación</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-3 overflow-y-auto px-3 pb-6">
          {CENTERS.map((center) => (
            <div key={center.id} className="flex flex-col gap-0.5">
              <p className="flex items-center gap-2 px-1 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
                <HugeiconsIcon icon={center.icon} className="size-4" />
                {center.label}
              </p>
              {center.sections
                .flatMap((s) => s.items)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
                  >
                    {item.label}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
