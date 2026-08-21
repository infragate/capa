import { readFileSync } from "fs";

/** Read UTF-8 text, or null if the file does not exist (avoids existsSync TOCTOU). */
export function readTextOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch (err: any) {
		if (err?.code === "ENOENT") return null;
		throw err;
	}
}
