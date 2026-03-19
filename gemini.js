import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

/**
 * Deteksi MIME type dari buffer, fallback ke "application/octet-stream"
 */
async function detectMimeType(buffer) {
    const result = await fileTypeFromBuffer(buffer);
    return result?.mime ?? "application/octet-stream";
}

/**
 * Daftar MIME type yang didukung Gemini (multimodal)
 * https://ai.google.dev/gemini-api/docs/vision
 */
const SUPPORTED_MIMES = new Set([
    // Gambar
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/heic", "image/heif",
    // Video
    "video/mp4", "video/mpeg", "video/mov", "video/avi",
    "video/x-flv", "video/mpg", "video/webm", "video/wmv", "video/3gpp",
    // Audio
    "audio/wav", "audio/mp3", "audio/aiff", "audio/aac",
    "audio/ogg", "audio/flac", "audio/mpeg", "audio/ogg; codecs=opus",
    // Dokumen
    "application/pdf",
    "text/plain", "text/html", "text/css", "text/javascript",
    "text/x-typescript", "text/csv", "text/markdown",
    "text/x-python", "application/json", "application/xml",
    "application/rtf",
]);

/**
 * Chat dengan Gemini, support file attachment otomatis via MIME detection
 * @param {Array} messages - Array of { role, content } atau { role, parts }
 * @param {Buffer|null} fileBuffer - Buffer file yang ingin dilampirkan
 */
async function chat(messages = [], fileBuffer = null) {
    // Ekstrak system message
    const systemMsg = messages.find(m => m.role === "system");
    const system_instruction = systemMsg
        ? (typeof systemMsg.content === "string"
            ? systemMsg.content
            : systemMsg.parts?.[0]?.text ?? "")
        : undefined;

    // Filter non-system, normalize ke format Gemini
    const history = messages
        .filter(m => m.role !== "system")
        .map(m => ({
            role: m.role === "assistant" ? "model" : m.role,
            parts: typeof m.content === "string"
                ? [{ text: m.content }]
                : m.parts ?? [{ text: "" }]
        }));

    // Jika ada file, inject ke parts message terakhir
    if (fileBuffer) {
        const mimeType = await detectMimeType(fileBuffer);

        if (!SUPPORTED_MIMES.has(mimeType)) {
            throw new Error(`File type "${mimeType}" tidak didukung oleh Gemini.`);
        }

        const base64Data = fileBuffer.toString("base64");

        const filePart = {
            inline_data: {
                mime_type: mimeType,
                data: base64Data,
            }
        };

        // Pastikan ada minimal 1 pesan user di history
        if (history.length === 0) {
            history.push({ role: "user", parts: [] });
        }

        const lastMsg = history[history.length - 1];

        // Kalau role terakhir bukan user, tambahkan message user baru
        if (lastMsg.role !== "user") {
            history.push({ role: "user", parts: [filePart] });
        } else {
            // Inject file ke parts pesan user terakhir
            lastMsg.parts.push(filePart);
        }
    }

    const payload = {
        action: "chat",
        messages: history,
        search: true,
        model: "gemini-3.1-pro-preview",
        ...(system_instruction && { system_instruction })
    };

    const { data } = await axios.post("https://wudysoft.xyz/api/ai/gemini/v10", payload, {
        headers: { "Content-Type": "application/json" }
    });

    return data.result.text;
}

export default chat;
