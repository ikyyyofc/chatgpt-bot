import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

const CONFIG = {
    GEMINI: {
        URL: "https://us-central1-gemmy-ai-bdc03.cloudfunctions.net/gemini",
        MODEL: "gemini-3.1-pro-preview",
        HEADERS: {
            "User-Agent": "okhttp/5.3.2",
            "Accept-Encoding": "gzip",
            "content-type": "application/json; charset=UTF-8"
        }
    }
};

const SUPPORTED_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
    "video/mp4",
    "video/mpeg",
    "video/mov",
    "video/avi",
    "video/x-flv",
    "video/mpg",
    "video/webm",
    "video/wmv",
    "video/3gpp",
    "audio/wav",
    "audio/mp3",
    "audio/aiff",
    "audio/aac",
    "audio/ogg",
    "audio/flac",
    "audio/mpeg",
    "audio/ogg; codecs=opus",
    "application/pdf",
    "text/plain",
    "text/html",
    "text/css",
    "text/javascript",
    "text/x-typescript",
    "text/csv",
    "text/markdown",
    "text/x-python",
    "application/json",
    "application/xml",
    "application/rtf"
]);

async function detectMimeType(buffer) {
    const result = await fileTypeFromBuffer(buffer);
    return result?.mime ?? "application/octet-stream";
}

async function getNewToken() {
    try {
        const response = await axios.post(
            "https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=AIzaSyAxof8_SbpDcww38NEQRhNh0Pzvbphh-IQ",
            { clientType: "CLIENT_TYPE_ANDROID" },
            {
                headers: {
                    "User-Agent":
                        "Dalvik/2.1.0 (Linux; U; Android 12; SM-S9280 Build/AP3A.240905.015.A2)",
                    "Content-Type": "application/json",
                    "X-Android-Package": "com.jetkite.gemmy",
                    "X-Android-Cert":
                        "037CD2976D308B4EFD63EC63C48DC6E7AB7E5AF2",
                    "X-Firebase-GMPID":
                        "1:652803432695:android:c4341db6033e62814f33f2"
                }
            }
        );
        return response.data.idToken;
    } catch (error) {
        return null;
    }
}

async function chat(messages = [], fileBuffer = null) {
    const token = await getNewToken();
    if (!token) throw new Error("Gagal mendapatkan token autentikasi Gemmy");

    const systemMsg = messages.find(m => m.role === "system");
    const systemInstructionText = systemMsg
        ? typeof systemMsg.content === "string"
            ? systemMsg.content
            : (systemMsg.parts?.[0]?.text ?? "")
        : undefined;

    const history = messages
        .filter(m => m.role !== "system")
        .map(m => ({
            role: m.role === "assistant" ? "model" : m.role,
            parts:
                typeof m.content === "string"
                    ? [{ text: m.content }]
                    : (m.parts ?? [{ text: "" }])
        }));

    if (fileBuffer) {
        const mimeType = await detectMimeType(fileBuffer);

        if (!SUPPORTED_MIMES.has(mimeType)) {
            throw new Error(
                `File type "${mimeType}" tidak didukung oleh Gemini.`
            );
        }

        const base64Data = fileBuffer.toString("base64");
        const filePart = {
            inlineData: {
                mimeType: mimeType,
                data: base64Data
            }
        };

        if (history.length === 0) {
            history.push({ role: "user", parts: [] });
        }

        const lastMsg = history[history.length - 1];
        if (lastMsg.role !== "user") {
            history.push({ role: "user", parts: [filePart] });
        } else {
            lastMsg.parts.push(filePart);
        }
    }

    const payload = {
        model: CONFIG.GEMINI.MODEL,
        request: {
            contents: history,
            generationConfig: {
                maxOutputTokens: 500,
                thinkingConfig: {
                    thinkingLevel: "HIGH"
                },
                temperature: 1,
                topP: 0.95
            },
            tools: [
                {
                    googleSearch: {},
                    urlContext: {}
                }
            ],
            ...(systemInstructionText && {
                systemInstruction: {
                    role: "user",
                    parts: [{ text: systemInstructionText }]
                }
            })
        },
        stream: false
    };

    const headers = {
        ...CONFIG.GEMINI.HEADERS,
        authorization: `Bearer ${token}`
    };

    const { data } = await axios.post(CONFIG.GEMINI.URL, payload, { headers });

    if (data?.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
    }

    throw new Error("No response candidates found");
}

export default chat;
