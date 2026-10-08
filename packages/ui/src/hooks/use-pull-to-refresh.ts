import { useEffect, useRef, useState, type RefObject } from "react";

export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
const DEAD_ZONE = 8;

/**
 * Pull down from the top of a scroll container to refresh. Uses touch events
 * because the browser cancels pointer events once it starts panning.
 */
export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
  enabled = true,
) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const callback = useRef(onRefresh);
  callback.current = onRefresh;
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || refreshing) return;
    let start: { x: number; y: number } | null = null;
    let pull = 0;
    const reset = () => {
      start = null;
      pull = 0;
      setDistance(0);
    };
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      pull = 0;
      start =
        event.touches.length === 1 && touch && element.scrollTop <= 0
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!pull) {
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
        // Horizontal swipes belong to task actions; upward moves scroll.
        if (dy <= 0 || Math.abs(dx) > dy || element.scrollTop > 0) {
          start = null;
          return;
        }
      }
      pull = Math.min(PULL_MAX, Math.max(1, (dy - DEAD_ZONE) / 2));
      setDistance(pull);
    };
    const onEnd = () => {
      const triggered = pull >= PULL_THRESHOLD;
      reset();
      if (!triggered) return;
      setRefreshing(true);
      void callback.current().finally(() => setRefreshing(false));
    };
    const options = { passive: true };
    element.addEventListener("touchstart", onStart, options);
    element.addEventListener("touchmove", onMove, options);
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", reset);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", reset);
      setDistance(0);
    };
  }, [ref, enabled, refreshing]);
  return { distance, refreshing };
}
