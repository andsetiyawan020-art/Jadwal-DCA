import { registerPlugin } from "@capacitor/core";

/**
 * Bridge TypeScript untuk FileSaverPlugin (custom Capacitor plugin).
 * Pada Android: membuka file picker via Storage Access Framework
 * (ACTION_CREATE_DOCUMENT) — user memilih sendiri lokasi simpan.
 * Pada platform lain: tidak dipakai (gunakan Blob download biasa).
 */
export interface FileSaverPlugin {
  saveFile(options: { filename: string; content: string }): Promise<void>;
}

const FileSaver = registerPlugin<FileSaverPlugin>("FileSaver");

export { FileSaver };
