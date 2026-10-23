import { useEffect, useRef, type ReactNode } from "react";
import { ActionButton } from "./ActionButton.tsx";

/** Expands inside the owning business section; never covers native navigation/chat. */
export function SectionPanel({
  title,
  children,
  onClose,
  returnFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const returnTarget = useRef(returnFocus);
  returnTarget.current = returnFocus;
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    return () => {
      const target = returnTarget.current?.() ?? (origin?.isConnected ? origin : null);
      target?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="creatorSectionPanel"
      role="region"
      aria-label={title}
      ref={root}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="creatorSectionHeading">
        <h4>{title}</h4>
        <ActionButton tone="ghost" onClick={onClose}>
          返回
        </ActionButton>
      </div>
      {children}
    </div>
  );
}
