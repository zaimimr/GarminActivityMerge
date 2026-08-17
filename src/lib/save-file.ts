/**
 * Saving the originals is the only backup that exists, so the merge must not
 * start until the bytes are actually on the user's disk.
 *
 * `<a download>` gives no such guarantee: click() returns immediately while the
 * browser may still be queueing, prompting or previewing the file. Where the
 * File System Access API exists we pick the destination up front and await the
 * write, which is a real guarantee. Everywhere else (iOS Safari, Firefox) we
 * fall back to the anchor and keep the blob in memory so the user can re-save it
 * if the download didn't stick.
 */

type SaveTarget = {
  /** Present when the browser can confirm the write. */
  handle: FileSystemFileHandle | null;
  /** True when the user dismissed the save dialog. */
  aborted: boolean;
};

type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

export function canConfirmSave(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showSaveFilePicker === "function";
}

/**
 * Ask where to put the file. Must be called directly from the confirming
 * gesture — after an await the browser has dropped transient activation and
 * will reject the picker.
 */
export async function pickSaveTarget(suggestedName: string): Promise<SaveTarget> {
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (!picker) return { handle: null, aborted: false };

  try {
    const handle = await picker({
      suggestedName,
      types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
    });
    return { handle, aborted: false };
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return { handle: null, aborted: true };
    // Anything else (unsupported, blocked in an iframe) falls back to the anchor.
    return { handle: null, aborted: false };
  }
}

/** Resolves once the bytes are written, when the browser lets us know that. */
export async function saveBlob(
  blob: Blob,
  filename: string,
  handle: FileSystemFileHandle | null
): Promise<{ confirmed: boolean }> {
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { confirmed: true };
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking too early can cancel an in-flight download on some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { confirmed: false };
}
