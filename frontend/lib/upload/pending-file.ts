// Hands a dropped File from one page to the next (dashboard drop -> /new) without a reload.
// Lives in memory only: a full page load starts empty, which is fine.
let pending: File | null = null;

export function setPendingFile(file: File) {
  pending = file;
}

export function takePendingFile(): File | null {
  const file = pending;
  pending = null;
  return file;
}
