/** Saving an export as a file, from an extension page (side panel or the how-to preview). */

export const safeFileName = (name: string) => name.replace(/[^\w.-]+/g, '-') || 'guides';

export function downloadText(fileName: string, text: string, type: string): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
