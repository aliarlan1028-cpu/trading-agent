import { useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusableInside(container) {
  if (!container) return [];
  return [...container.querySelectorAll(focusableSelector)].filter((node) => node.getAttribute("aria-hidden") !== "true" && !node.hidden);
}

export function useDialogFocus({ open, containerRef, onClose, triggerRef } = {}) {
  const closeRef = useRef(onClose);
  const returnFocus = useRef(null);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !containerRef?.current) return undefined;
    const container = containerRef.current;
    returnFocus.current = triggerRef?.current || document.activeElement;
    const first = focusableInside(container)[0] || container;
    requestAnimationFrame(() => first.focus({ preventScroll: true }));

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableInside(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === firstItem || !container.contains(document.activeElement))) {
        event.preventDefault();
        lastItem.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const target = triggerRef?.current || returnFocus.current;
      requestAnimationFrame(() => target?.focus?.({ preventScroll: true }));
    };
  }, [open, containerRef, triggerRef]);
}
