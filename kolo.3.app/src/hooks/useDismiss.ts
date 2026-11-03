import { useEffect, useRef, type RefObject } from "react";

// Closes a popover on Escape and, unless `outside` is false, on a press
// outside `ref`. The Escape is marked handled so window-level shortcuts don't
// also act on it.
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
  { outside = true } = {},
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (outside && ref.current && !ref.current.contains(event.target as Node))
        dismissRef.current();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      dismissRef.current();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, ref, outside]);
}
