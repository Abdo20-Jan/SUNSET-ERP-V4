"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { TireIcon } from "@hugeicons/core-free-icons";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NAV_GROUPS } from "@/components/layout/nav-items";
import { UserMenu } from "@/components/layout/user-menu";

type AppSidebarProps = {
  user: { nombre: string; username: string; role: string };
};

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <HugeiconsIcon icon={TireIcon} className="size-4" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-[13px] font-semibold tracking-tight">
              Sunset Tires
            </span>
            <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
              ERP · v4
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="px-1.5 py-1">
            <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 group-data-[collapsible=icon]:hidden">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        className="h-7 gap-2 px-2 text-[13px] font-medium data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold"
                        render={<Link href={item.href} />}
                      >
                        <HugeiconsIcon icon={item.icon} className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60 p-1.5">
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
