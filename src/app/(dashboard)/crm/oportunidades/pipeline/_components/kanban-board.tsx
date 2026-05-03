"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moverStageAction } from "@/lib/actions/oportunidades";

type Stage = { id: string; nombre: string };

type Card = {
  id: string;
  numero: string;
  titulo: string;
  montoLabel: string;
  stageId: string;
  leadOClienteNombre: string;
  leadOClienteHref: string | null;
};

export function KanbanBoard({
  stages,
  cards: initialCards,
}: {
  stages: Stage[];
  cards: Card[];
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [pending, start] = useTransition();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onDragStart(e: React.DragEvent, cardId: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
    setDraggingId(cardId);
  }

  function onDragEnd() {
    setDraggingId(null);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("text/plain");
    setDraggingId(null);
    if (!cardId) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.stageId === stageId) return;
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, stageId } : c)),
    );
    setError(null);
    start(async () => {
      const r = await moverStageAction(cardId, stageId);
      if (!r.ok) {
        setError(r.error);
        setCards((prev) =>
          prev.map((c) => (c.id === cardId ? { ...c, stageId: card.stageId } : c)),
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const stageCards = cards.filter((c) => c.stageId === stage.id);
          return (
            <div
              key={stage.id}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, stage.id)}
              className="flex min-w-[260px] flex-1 flex-col rounded-md border bg-muted/30 p-3"
            >
              <div className="mb-2 flex items-center justify-between text-sm font-medium">
                <span>{stage.nombre}</span>
                <span className="text-xs text-muted-foreground">{stageCards.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {stageCards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, card.id)}
                    onDragEnd={onDragEnd}
                    className={`rounded-md border bg-background p-2 text-sm shadow-sm hover:bg-muted ${
                      draggingId === card.id ? "opacity-50" : ""
                    } ${pending ? "cursor-wait" : "cursor-grab"}`}
                  >
                    <Link
                      href={`/crm/oportunidades/${card.id}`}
                      className="block font-medium text-primary hover:underline"
                    >
                      {card.numero}
                    </Link>
                    <div className="mt-0.5">{card.titulo}</div>
                    <div className="mt-1 text-xs font-medium">{card.montoLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {card.leadOClienteHref ? (
                        <Link
                          href={card.leadOClienteHref}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {card.leadOClienteNombre}
                        </Link>
                      ) : (
                        card.leadOClienteNombre
                      )}
                    </div>
                  </div>
                ))}
                {stageCards.length === 0 && (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
