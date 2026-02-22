import { useRef, useCallback } from 'react';

/**
 * Manages a native DOM clone as a drag overlay, completely bypassing React's
 * render cycle. Uses `pointerrawupdate` for lowest-latency cursor tracking
 * and rAF gating to batch transforms to one per display frame.
 *
 * The clone is a pixel-perfect copy of the dragged element styled to float
 * above everything with a solid dark background and shadow.
 */
export function useDragOverlayClone() {
  const cloneRef = useRef<HTMLElement | null>(null);
  const startYRef = useRef(0);
  const rafRef = useRef(0);
  const latestYRef = useRef(0);

  // rAF callback — applies the latest pointer position once per frame
  const applyTransform = useRef(() => {
    const clone = cloneRef.current;
    if (!clone) return;
    const dy = latestYRef.current - startYRef.current;
    clone.style.transform = `translateY(${dy}px) scale(1.02)`;
    rafRef.current = 0;
  });

  const onPointerUpdate = useRef((e: PointerEvent) => {
    // Grab the latest Y (use coalesced events if available for highest fidelity)
    const coalesced = (e as any).getCoalescedEvents?.();
    const latest = coalesced?.length ? coalesced[coalesced.length - 1] : e;
    latestYRef.current = latest.clientY;

    // Schedule one transform per frame
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(applyTransform.current);
    }
  });

  const cleanup = useCallback(() => {
    window.removeEventListener('pointerrawupdate' as any, onPointerUpdate.current);
    window.removeEventListener('pointermove', onPointerUpdate.current);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (cloneRef.current) {
      cloneRef.current.remove();
      cloneRef.current = null;
    }
  }, []);

  const showClone = useCallback((activeId: string, activeType: 'task' | 'list', pointerY: number) => {
    // Find the source element
    const selector = activeType === 'task'
      ? `[data-task-id="${activeId}"]`
      : `[data-testid="list-header-${activeId}"]`;
    const source = document.querySelector<HTMLElement>(selector);
    if (!source) return;

    const rect = source.getBoundingClientRect();
    startYRef.current = pointerY;
    latestYRef.current = pointerY;

    // Clone the DOM node inside a dark-themed wrapper so Tailwind's
    // dark: variants resolve correctly (the app's `dark` class is on
    // a container div, not on <body>).
    const wrapper = document.createElement('div');
    wrapper.className = 'dark';
    wrapper.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      z-index: 9999;
      pointer-events: none;
      overflow: hidden;
      will-change: transform;
      transition: none;
    `;

    const clone = source.cloneNode(true) as HTMLElement;
    clone.style.cssText = `
      border-radius: 8px;
      background: hsl(240 6% 10% / 0.95);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
    `;
    // Strip interactive attributes from clone
    clone.querySelectorAll('button, a, input, textarea').forEach(el => {
      (el as HTMLElement).style.pointerEvents = 'none';
      el.removeAttribute('tabindex');
    });

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    cloneRef.current = wrapper;

    // Use pointerrawupdate for lowest-latency input (fires at hardware rate),
    // fall back to pointermove for browsers that don't support it.
    if ('onpointerrawupdate' in window) {
      window.addEventListener('pointerrawupdate' as any, onPointerUpdate.current, { passive: true });
    } else {
      window.addEventListener('pointermove', onPointerUpdate.current, { passive: true });
    }
  }, []);

  const hideClone = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return { showClone, hideClone };
}
