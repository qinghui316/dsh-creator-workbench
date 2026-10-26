/** Bound read-only work. Never use this for writes: timeout does not undo effects. */
export async function boundedRead<T>(work: Promise<T>, ms = 4000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("目录响应超时，请确认连接后重试。"), { code: "ETIMEDOUT" })), ms); })]); }
  finally { clearTimeout(timer); }
}
