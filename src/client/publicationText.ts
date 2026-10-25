import type { PublicationInput } from "../production/types.ts";

/** Adapt an explicit reuse/copy operation, without changing the source document. */
export function publicationText(source:string,platform:PublicationInput["platform"],type:PublicationInput["type"],format?:"html"|"markdown"):string {
  if (type==="article"&&(platform==="official-account"||platform==="bilibili")) return source;
  if (format!=="html"&&!/^\s*(?:<!doctype\s+html|<(?:html|head|style|script|body|article|section|div|p|h[1-6])\b)/i.test(source.replace(/<!--([\s\S]*?)-->/g,""))) return source;
  const text=source.replace(/<!--([\s\S]*?)-->/g,"").replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/(?:p|h[1-6]|div|section|article|li|ul|ol|blockquote|tr)\s*>/gi,"\n\n").replace(/<li\b[^>]*>/gi,"• ").replace(/<[^>]*>/g,"");
  // Decode entity tokens only; no document parsing or resource requests.
  const decoder=document.createElement("textarea");
  return text.replace(/&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g,entity=>{decoder.innerHTML=entity;return decoder.value;}).replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
