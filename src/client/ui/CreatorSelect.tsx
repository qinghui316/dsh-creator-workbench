import { Children, Fragment, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { placeOptionHighlight, useControlPopup } from "./useControlPopup.ts";
import "./ControlPopup.css";

type Option = { value: string; label: ReactNode; text: string; disabled: boolean };
function textOf(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : String(child)).join("");
}
function optionsOf(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return [];
    if (child.type === Fragment) return optionsOf(child.props.children);
    if (child.type !== "option") return [];
    return [{ value: String(child.props.value ?? textOf(child.props.children)), label: child.props.children, text: textOf(child.props.children), disabled: !!child.props.disabled }];
  });
}
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value" | "defaultValue" | "multiple" | "size"> & {
  value: string; onValueChange: (value: string) => void; loading?: boolean; error?: string;
};

/** Controlled selection: browsing is local; only explicit confirmation invokes the caller. */
export function CreatorSelect({ value, onValueChange, children, disabled, loading, error, className = "", name, required, ...props }: Props) {
  const options = optionsOf(children), selected = options.findIndex(option => option.value === value);
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const root = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), highlight = useRef<HTMLSpanElement>(null);
  const composing = useRef(false), search = useRef({ value: "", at: 0 }), primed = useRef(false), committed = useRef(false);
  const uid = useId(), id = `${uid}-list`;
  const close = () => setOpen(false);
  const layoutHighlight = () => {
    const item = popup.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`);
    if (popup.current && item && highlight.current) placeOptionHighlight(popup.current, item, highlight.current, false);
  };
  const layer = useControlPopup(open, close, root, trigger, popup, "start", true, layoutHighlight);
  const enabled = error ? [] : options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  useLayoutEffect(() => {
    if (open && (error || !options[active] || options[active]?.disabled)) setActive(enabled[0] ?? -1);
  }, [open, active, error, options.map(option => `${option.value}:${option.disabled}`).join("\0")]);
  useLayoutEffect(() => {
    if (!open) { primed.current = false; return; }
    const item = popup.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`);
    if (popup.current && item && highlight.current) placeOptionHighlight(popup.current, item, highlight.current, primed.current && layer.motion);
    primed.current = true;
  }, [open, active, options.length, layer.motion]);
  useLayoutEffect(() => { if (disabled || loading) setOpen(false); }, [disabled, loading]);
  const show = (last = false) => {
    if (disabled || loading) return;
    committed.current = false; search.current = { value: "", at: 0 };
    setActive(!error && selected >= 0 && !options[selected]?.disabled ? selected : enabled[last ? enabled.length - 1 : 0] ?? -1); setOpen(true);
  };
  const confirm = (index: number) => {
    const option = options[index];
    if (!open || error || committed.current || !option || option.disabled) return;
    committed.current = true; close(); trigger.current?.focus({ preventScroll: true });
    if (option.value !== value) onValueChange(option.value);
  };
  return <span ref={root} className={`creatorSelect ${className}`} onBlurCapture={event => {
    if (event.relatedTarget instanceof Node) { if (!event.currentTarget.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) close(); }
    else queueMicrotask(() => { if (root.current?.isConnected && !root.current.contains(document.activeElement) && !popup.current?.contains(document.activeElement)) close(); });
  }}>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <button {...props as React.ButtonHTMLAttributes<HTMLButtonElement>} id={props.id ?? `${uid}-trigger`} value={value} ref={trigger} type="button" role="combobox" className="creatorSelectTrigger" disabled={disabled || loading} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox" aria-required={required} aria-busy={loading || undefined} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      onClick={() => open ? close() : show()} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Tab") { close(); return; }
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (!open) { show(event.key === "ArrowUp" || event.key === "End"); return; }
          const position = enabled.indexOf(active);
          setActive(enabled[event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (position + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length] ?? -1); return;
        }
        if (event.key === "Enter" || event.key === " " && !search.current.value) { event.preventDefault(); event.stopPropagation(); if (open) confirm(active); else show(); return; }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); if (!open) show();
          const now = Date.now(), previous = search.current;
          const query = (now - previous.at < 650 ? previous.value : "") + event.key.toLocaleLowerCase();
          search.current = { value: query, at: now };
          const needle = [...query].every(character => character === query[0]) ? query.charAt(0) : query;
          const ordered = [...enabled.filter(i => i > active), ...enabled.filter(i => i <= active)];
          const found = ordered.find(i => options[i]?.text.toLocaleLowerCase().startsWith(needle));
          if (found !== undefined) setActive(found);
        }
      }}>
      <span className="creatorSelectValue" title={options[selected]?.text}>{loading ? "正在读取…" : options[selected]?.label ?? "请选择"}</span>
      <svg className="creatorSelectChevron" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {layer.mounted && createPortal(<div ref={popup} id={id} role={open ? "listbox" : undefined} aria-label={props["aria-label"] ? `${props["aria-label"]}选项` : undefined} aria-labelledby={!props["aria-label"] ? props["aria-labelledby"] ?? props.id ?? `${uid}-trigger` : undefined} aria-hidden={!open || undefined} data-plugin="dsh-creator-workbench" data-control-popup="select" data-phase={layer.phase} data-motion={layer.motion} className="creatorControlPopup creatorSelectPopup">
      <span ref={highlight} className="creatorOptionHighlight" aria-hidden="true" hidden={active < 0} />
      {error ? <p role="alert" className="creatorPopupMessage">{error}</p> : !options.length ? <p className="creatorPopupMessage">暂无选项</p> : options.map((option, index) => option.disabled && option.value === "" && value !== "" && selected >= 0 ? null : <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-option-value={option.value} data-option-index={index} data-highlighted={active === index || undefined} className="creatorSelectOption" onPointerMove={event => { if (open && !option.disabled && event.pointerType !== "touch") setActive(index); }} onPointerDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); event.stopPropagation(); confirm(index); }}>
        <span>{option.label}</span><span className="creatorSelectCheck" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
      </div>)}
    </div>, document.body)}
  </span>;
}
