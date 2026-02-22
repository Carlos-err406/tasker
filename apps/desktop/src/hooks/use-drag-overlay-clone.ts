import { useRef, useCallback } from 'react';

/**
 * Manages a native DOM clone as a drag overlay, completely bypassing React's
 * render cycle. On every pointermove the clone's CSS transform is updated
 * directly on the element — no state, no reconciliation, no context re-renders.
 *
 * The clone is a pixel-perfect copy of the dragged element styled to float
 * above everything with a frosted glass background and shadow.
 */
export function useDragOverlayClone() {
  const cloneRef = useRef<HTMLElement | null>(null);
  const startYRef = useRef(0);

  const onPointerMove = useRef((e: PointerEvent) => {
    const clone = cloneRef.current;
    if (!clone) return;
    const dy = e.clientY - startYRef.current;
    clone.style.transform = `translateY(${dy}px) scale(1.02)`;
  });

  const cleanup = useCallback(() => {
    window.removeEventListener('pointermove', onPointerMove.current);
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

    // Clone the DOM node
    const clone = source.cloneNode(true) as HTMLElement;
    clone.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      z-index: 9999;
      pointer-events: none;
      border-radius: 8px;
      background: hsl(240 6% 10% / 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
      transform: scale(1.02);
      will-change: transform;
      transition: none;
    `;
    // Strip interactive attributes from clone
    clone.querySelectorAll('button, a, input, textarea').forEach(el => {
      (el as HTMLElement).style.pointerEvents = 'none';
      el.removeAttribute('tabindex');
    });

    document.body.appendChild(clone);
    cloneRef.current = clone;

    window.addEventListener('pointermove', onPointerMove.current, { passive: true });
  }, []);

  const hideClone = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return { showClone, hideClone };
}
