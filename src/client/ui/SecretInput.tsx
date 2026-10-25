import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";

/** Reveals only the current controlled input; stored credentials never enter this component. */
export function SecretInput(props:Omit<InputHTMLAttributes<HTMLInputElement>,"type">) {
  const input=useRef<HTMLInputElement>(null),selection=useRef<{start:number|null;end:number|null;direction:"forward"|"backward"|"none"|null}>();
  const [visible,setVisible]=useState(false);
  useLayoutEffect(()=>{const saved=selection.current;if(saved&&input.current){input.current.setSelectionRange(saved.start,saved.end,saved.direction??undefined);selection.current=undefined;}},[visible]);
  useLayoutEffect(()=>{if(!props.value)setVisible(false);},[props.value]);
  const toggle=()=>{const field=input.current;if(!field)return;selection.current={start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection};setVisible(value=>!value);};
  return <span className="creatorSecretInput"><input {...props} ref={input} type={visible?"text":"password"} autoComplete="off" spellCheck={false}/><button type="button" className="creatorSecretToggle" aria-label={visible?"隐藏密钥":"显示密钥"} aria-pressed={visible} disabled={props.disabled||!props.value} onPointerDown={event=>event.preventDefault()} onClick={toggle}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>{visible&&<path d="m4 3 16 18"/>}</svg></button></span>;
}
