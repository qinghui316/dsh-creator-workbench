/** Shared by creation and its path preview; contains no filesystem or UI dependencies. */
export function projectTitle(title: string): string {
  return title.trim().replace(/[\\/:*?"<>|\n\r]/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/, "");
}
export function datedProjectName(title: string, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${day}_${projectTitle(title)}`;
}
