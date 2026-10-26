/** A timed-out write remains uncertain; caller must read the original location result. */
export async function directoryReply<T>(request: Promise<T>, timeout = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("保存位置结果暂未确认。")), timeout); })]); }
  finally { clearTimeout(timer); }
}
