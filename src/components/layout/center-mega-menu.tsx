"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NavCenter, NavItem } from "@/components/layout/nav-config";

function MegaMenuLink({ item }: { item: NavItem }) {
  return (
    <DropdownMenuItem
      render={<Link href={item.href} />}
      className="gap-2 rounded-md px-1.5 py-1 text-[12.5px]"
    >
      <HugeiconsIcon icon={item.icon} className="size-4 text-muted-foreground" />
      {item.label}
    </DropdownMenuItem>
  );
}

export function CenterMegaMenu({ center, active }: { center: NavCenter; active: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {center.label}
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="grid w-auto min-w-[28rem] grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-3 rounded-md p-4"
      >
        {center.sections.map((section) => (
          <DropdownMenuGroup key={section.label} className="flex flex-col gap-1">
            <DropdownMenuLabel className="px-1 py-0 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              {section.label}
            </DropdownMenuLabel>
            {section.items.map((item) => (
              <MegaMenuLink key={item.href} item={item} />
            ))}
          </DropdownMenuGroup>
        ))}
        {center.crossLinks && center.crossLinks.length > 0 ? (
          <DropdownMenuGroup className="flex flex-col gap-1">
            <DropdownMenuLabel className="px-1 py-0 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              Atajos
            </DropdownMenuLabel>
            {center.crossLinks.map((item) => (
              <MegaMenuLink key={item.href} item={item} />
            ))}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
