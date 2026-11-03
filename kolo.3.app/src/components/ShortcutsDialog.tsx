import { Keyboard, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef } from "react";
import { SHORTCUTS } from "../hooks/useKeyboardShortcuts";

export function ShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        // The close button is the dialog's only interactive element.
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.focus();
      }
    }
    function keepFocusInside(event: FocusEvent) {
      if (
        event.target instanceof Node &&
        !dialogRef.current?.contains(event.target)
      ) {
        closeRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", keepFocusInside);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      } else {
        // The profile menu item may have disappeared when opening the dialog.
        document
          .querySelector<HTMLButtonElement>('[aria-label="Open profile"]')
          ?.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="shortcuts-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header className="shortcuts-header">
          <Keyboard size={20} aria-hidden="true" />
          <h2 id={headingId}>Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="shortcuts-close"
            aria-label="Close shortcuts"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="shortcuts-groups">
          {SHORTCUTS.map(({ group, items }) => (
            <section className="shortcuts-group" key={group}>
              <h3>{group}</h3>
              <ul>
                {items.map(({ combos, label }) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span className="shortcuts-keys">
                      {combos.map((keys, index) => (
                        <Fragment key={keys.join("+")}>
                          {index > 0 && <small>or</small>}
                          {keys.map((key) => (
                            <kbd key={key}>{key}</kbd>
                          ))}
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
