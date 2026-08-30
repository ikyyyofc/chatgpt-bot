import axios from "axios";
import FormData from "form-data";
import { fileTypeFromBuffer } from "file-type";

/**
 * Mengunggah file buffer ke hosting Catbox.moe
 * @param {Buffer|Uint8Array} inputBuffer Buffer file yang akan diunggah
 * @param {string} [userhash] Opsional: Catbox userhash akun
 * @returns {Promise<string|false>} URL direct file yang berhasil diunggah atau false jika gagal
 */
export default async function upload(inputBuffer, userhash = process.env.CATBOX_USERHASH || "") {
    if (!inputBuffer) return false;

    const buffer = Buffer.isBuffer(inputBuffer) ? inputBuffer : Buffer.from(inputBuffer);
    if (buffer.length === 0) return false;

    let ext = "bin";
    let mime = "application/octet-stream";

    try {
        const detected = await fileTypeFromBuffer(buffer);
        if (detected?.ext) ext = detected.ext;
        if (detected?.mime) mime = detected.mime;
    } catch {
        // Fallback ke ekstensi default jika deteksi tipe gagal
    }

    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const filename = `${uniqueId}.${ext}`;

    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const form = new FormData();
            form.append("reqtype", "fileupload");
            if (userhash) {
                form.append("userhash", userhash);
            }
            form.append("fileToUpload", buffer, {
                filename,
                contentType: mime
            });

            const response = await axios.post("https://catbox.moe/user/api.php", form, {
                headers: {
                    ...form.getHeaders()
                },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (typeof response.data === "string" && response.data.trim().startsWith("http")) {
                return response.data.trim();
            }

            throw new Error(`Respon Catbox tidak valid: ${response.data}`);
        } catch (err) {
            console.warn(`[Upload Catbox] Percobaan #${attempt} gagal: ${err.message}`);
            if (attempt === maxRetries) {
                console.error("[Upload] Upload ke Catbox gagal setelah semua percobaan.");
                return false;
            }
            await new Promise(res => setTimeout(res, 1000));
        }
    }

    return false;
}
