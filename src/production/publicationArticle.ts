import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, relative } from "node:path";
import { hashText, inside } from "./storage.ts";
import type { PublicationDraft } from "./types.ts";

const isHtmlBody = (body: string) => /^\s*(?:<!doctype\s+html|<(?:html|head|style|script|body|article|section|div|p|h[1-6])\b)/i.test(body.replace(/<!--([\s\S]*?)-->/g,""));

/** Store platform copy with its own resource base and explicit article image order. */
export async function platformArticleBody(folder: string, dir: string, body: string, sourceFile: string | undefined, selected: string[] | undefined): Promise<string> {
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|<img\b[^>]*>/gi;
  const refs = [...body.matchAll(pattern)];
  const html = isHtmlBody(body);
  const resolve = async (value: string): Promise<string> => {
    try { return await inside(folder, join(dir, decodeURIComponent(value))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !sourceFile) throw error;
      return inside(folder, join(dirname(await inside(folder, sourceFile)), decodeURIComponent(value)));
    }
  };
  const paths = await Promise.all(refs.map(async ref => {
    const value = ref[2]?.split(/\s+["']/)[0] ?? ref[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!value || /^(?:https?:|data:|file:|\/\/)/i.test(value)) return undefined;
    try { return await resolve(value); } catch (error) { if (selected !== undefined) return undefined; throw error; }
  }));
  const targets = selected ? await Promise.all(selected.map(file => inside(folder, file))) : undefined;
  const localRef = (file: string, alt: string, asHtml: boolean) => {
    const value = relative(dir, file).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
    return asHtml ? `<img src="${value}" alt="${alt.replace(/[&<>"']/g, "")}">` : `![${alt.replace(/[\[\]]/g, "")}](${value})`;
  };
  let index = 0;
  const result = body.replace(pattern, () => {
    const current = index++, ref = refs[current]!, asHtml = ref[0].startsWith("<");
    const target = targets ? targets[current] : paths[current];
    if (targets && !target) return "";
    if (!target) return ref[0];
    const original = targets ? paths.findIndex(path => path?.toLowerCase() === target.toLowerCase()) : current;
    const originalRef = refs[original];
    const alt = originalRef?.[1] ?? originalRef?.[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "配图";
    return localRef(target, alt, asHtml);
  });
  return targets && targets.length > refs.length ? result + targets.slice(refs.length).map(file => `\n\n${localRef(file, "配图", html)}`).join("") : result;
}

/** Rebase actual project resources into an immutable task-owned article, never edit its source. */
export async function snapshotPublicationArticle(folder: string, dir: string, publication: Pick<PublicationDraft, "articleFile" | "bodyFile">, body: string, images: string[], format?: "markdown" | "html", repairIncomplete = false): Promise<string> {
  const source = await inside(folder, publication.bodyFile);
  const complete = async (file: string, bytes: Uint8Array) => {
    try { await writeFile(file, bytes, { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const actual = await inside(folder, file);
      if ((await readFile(actual)).equals(bytes)) return;
      if (!repairIncomplete) throw new Error("本次文章快照与原提交不一致，请核对原任务。");
      // Only manifest-bound, unregistered editor-save/preview directories opt into repair.
      // Preserve the incomplete bytes for recovery; existing versions never enter this path.
      await rename(actual, `${actual}.incomplete-${randomUUID()}`);
      await writeFile(file, bytes, { flag: "wx" });
    }
  };
  const html = format ? format === "html" : isHtmlBody(body) || /\.html?$/i.test(publication.articleFile ?? source) && /<\w+[\s>]/.test(body), refs = [...body.matchAll(html ? /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi : /!\[[^\]]*\]\(([^)]+)\)/g)];
  let rendered = body;
  const freeze = async (path: string) => {
    const bytes = await readFile(await inside(folder, path));
    if (bytes.length > 24 * 1024 * 1024) throw new Error("文章配图超过 24 MB，请先处理后再上传。");
    const name = `article-image-${hashText(bytes.toString("base64"))}${extname(path).toLowerCase()}`, target = join(dir, name);
    await complete(target, bytes);
    return name;
  };
  for (const match of refs) {
    const encoded = match[1]!.split(/\s+["']/)[0]!;
    const value = html ? encoded.replaceAll("&amp;", "&").replaceAll("&#38;", "&").replaceAll("&#x26;", "&") : encoded;
    if (/^(?:https?:|file:|data:|\/\/)/i.test(value)) { if (!value.startsWith("data:")) throw new Error("请先将文章配图导入本项目。"); continue; }
    let file: string;
    try { file = await inside(folder, join(dirname(source), decodeURIComponent(value))); }
    catch (error) {
      // Copied article bodies may still use the source version's relative paths.
      // An independent platform body's own paths take precedence; only a missing
      // local resource can fall back, never a failed directory-boundary check.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !publication.articleFile) throw error;
      const origin = await inside(folder, publication.articleFile);
      file = await inside(folder, join(dirname(origin), decodeURIComponent(value)));
    }
    const target = await freeze(file);
    rendered = rendered.split(match[0]).join(match[0].replace(encoded, target));
  }
  if (!refs.length && images.length) for (const file of images) { const local = await freeze(file); rendered += html ? `\n<p><img src="${local}" alt="配图"></p>` : `\n\n![配图](${local})`; }
  const file = join(dir, html ? "publication-body.html" : "publication-body.md");
  await complete(file, Buffer.from(rendered, "utf8"));
  return file;
}

/** Render a separately titled platform body without altering its frozen submission. */
export async function publicationArticleForRender(folder: string, article: string, title: string): Promise<string> {
  const source = await inside(folder, article);
  if (/\.html?$/i.test(source)) return source;
  const body = await readFile(source, "utf8");
  const rendered = `# ${title.replace(/[\r\n]+/g, " ").trim()}\n\n${body.replace(/^\uFEFF?\s*#\s+[^\r\n]*(?:\r?\n|$)/, "").trimStart()}`;
  const file = join(dirname(source), `publication-render-${hashText(rendered)}.md`);
  try { await writeFile(file, rendered, { encoding: "utf8", flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(file, "utf8") !== rendered) throw error; }
  return file;
}
