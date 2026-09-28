import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "./ui/button.js";

export function PanelHeader({
  title,
  icon: Icon,
  onClose,
  children,
}: {
  title: string;
  icon: LucideIcon;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <header
      data-testid="panel-header"
      className="flex shrink-0 items-center gap-2 px-3 py-2 bg-secondary/20 border-b border-border/50"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className="h-5 w-5 p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Back to tasks"
        onClick={onClose}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold flex-1">{title}</h2>
      {children}
    </header>
  );
}
