export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}
