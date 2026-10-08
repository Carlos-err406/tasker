import { RefreshCw } from "lucide-react";
import { PULL_THRESHOLD } from "../hooks/use-pull-to-refresh.js";
import { cn } from "../lib/utils.js";

export function PullToRefreshIndicator({
  distance,
  refreshing,
}: {
  distance: number;
  refreshing: boolean;
}) {
  const height = refreshing ? 40 : distance;
  const ready = refreshing || distance >= PULL_THRESHOLD;
  return (
    <div
      data-testid="pull-to-refresh"
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden text-muted-foreground",
        !distance && "transition-[height] duration-200",
      )}
      style={{ height }}
    >
      <RefreshCw
        className={cn("size-5", ready && "text-foreground", refreshing && "animate-spin")}
        style={
          refreshing
            ? undefined
            : {
                transform: `rotate(${(distance / PULL_THRESHOLD) * 270}deg)`,
                opacity: Math.min(1, distance / PULL_THRESHOLD),
              }
        }
      />
    </div>
  );
}
