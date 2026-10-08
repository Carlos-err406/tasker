import { useRef } from "react";
import { ChevronDown, Plus, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu.js";
import { Button } from "./ui/button.js";
import { ALL_LISTS, ALL_LISTS_LABEL, listLabel } from "../lib/all-lists.js";

export function ListPicker({
  className,
  side,
  lists,
  selected,
  defaultList,
  disabled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  className?: string;
  side?: "top" | "bottom";
  lists: string[];
  selected: string;
  defaultList: string;
  disabled: boolean;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const pendingForm = useRef<"create" | "rename" | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={className}
          aria-label="Choose list"
          disabled={disabled}
          title={listLabel(selected)}
        >
          <span>{listLabel(selected)}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={side}
        collisionPadding={8}
        aria-label="Lists"
        className="w-56 max-w-[calc(100vw-24px)]"
        onCloseAutoFocus={(event) => {
          const action = pendingForm.current;
          if (!action) return;
          event.preventDefault();
          pendingForm.current = null;
          if (action === "create") onCreate();
          else onRename();
        }}
      >
        <DropdownMenuRadioGroup value={selected}>
          <DropdownMenuRadioItem
            value={ALL_LISTS}
            onSelect={() => onSelect(ALL_LISTS)}
          >
            {ALL_LISTS_LABEL}
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {lists.map((name) => (
            <DropdownMenuRadioItem
              key={name}
              value={name}
              className="break-all"
              onSelect={() => onSelect(name)}
            >
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            pendingForm.current = "create";
          }}
        >
          <Plus /> Create list
        </DropdownMenuItem>
        {selected !== defaultList && selected !== ALL_LISTS && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                pendingForm.current = "rename";
              }}
            >
              <Pencil /> Rename list
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete list
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
