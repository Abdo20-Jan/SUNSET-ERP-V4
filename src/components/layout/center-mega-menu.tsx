"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { NavCenter } from "@/components/layout/nav-config";

export function CenterMegaMenu({ center, active }: { center: NavCenter; active: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {center.label}
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="grid w-auto min-w-[28rem] grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-3 p-4"
      >
        {center.sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <p className="px-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              {section.label}
            </p>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <HugeiconsIcon icon={item.icon} className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        {center.crossLinks && center.crossLinks.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="px-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              Atajos
            </p>
            {center.crossLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <HugeiconsIcon icon={item.icon} className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
