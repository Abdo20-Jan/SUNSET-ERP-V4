"use client";

import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";

import { cn } from "@/lib/utils";

function Menubar({ className, ...props }: MenubarPrimitive.Props) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      // modal=false: barra de navegación, no debe bloquear scroll/foco del resto
      modal={false}
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

export { Menubar };
