import { useImagePreview } from "./ImagePreview.tsx";
import DOMPurify from "dompurify";
import { useMemo } from "react";

/** Scripts stay disabled. Same-origin access is only used to wire image events. */
export function ArticlePreview({ html, title = "文章排版预览" }: { html: string; title?: string }) {
  const preview = useImagePreview();
  const content=useMemo(()=>DOMPurify.sanitize(html,{WHOLE_DOCUMENT:true,FORBID_TAGS:["script","iframe","object","embed","form","base","meta","link"],FORBID_ATTR:["srcdoc","formaction"],RETURN_TRUSTED_TYPE:false}),[html]);
  const policy = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return <iframe title={title} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="${policy}">${content}`} onLoad={e => {
    const frame = e.currentTarget, doc = frame.contentDocument;
    if (!doc) return;
    const images = [...doc.querySelectorAll<HTMLImageElement>("img")].filter(i => /^(?:data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml);|blob:)/i.test(i.src));
    images.forEach((image, index) => {
      image.tabIndex = 0; image.setAttribute("role", "button"); image.setAttribute("aria-label", `放大查看：${image.alt || `图片 ${index + 1}`}`); image.style.cursor = "zoom-in";
      const open = () => preview.open(images.map((item, n) => ({ id: String(n), title: item.alt || `文章图片 ${n + 1}`, content: <img src={item.src} alt={item.alt || `文章图片 ${n + 1}`} /> })), String(index), image);
      image.addEventListener("click", event => { event.preventDefault(); open(); });
      image.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
    });
  }} />;
}
