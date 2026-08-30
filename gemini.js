import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

// ============================================
// 1. KONFIGURASI MODEL & HEADERS (Sama dengan plugins/ai.js)
// ============================================
const GEMINI = {
    URL: "https://firebasevertexai.googleapis.com/v1beta/projects/gemmy-ai-bdc03/models",
    MODEL: "gemini-flash-latest",
    HEADERS: {
        "Content-Type": "application/json",
        "x-goog-api-key": "AIzaSyAxof8_SbpDcww38NEQRhNh0Pzvbphh-IQ",
        "x-goog-api-client": "gl-kotlin/2.2.21-ai fire/17.7.0",
        "x-firebase-appid": "1:652803432695:android:c4341db6033e62814f33f2",
        "x-firebase-appversion": "128"
    }
};

const geminiState = {
    token: null,
    count: 0
};

// ============================================
// 2. MIME TYPES YANG DIDUKUNG
// ============================================
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

// ============================================
// 3. AUTHENTICATION & REQUEST (Sama dengan plugins/ai.js)
// ============================================
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
    } catch {
        return null;
    }
}

function isThrottled(error) {
    const status = error.response?.status;
    const msg = (
        error.response?.data?.error?.message ||
        error.message ||
        ""
    ).toLowerCase();
    return (
        status === 429 ||
        [
            "quota",
            "rate",
            "resource exhausted",
            "too many requests",
            "limit"
        ].some(k => msg.includes(k))
    );
}

async function fetchGemini(url, payload) {
    let lastError;
    for (let i = 0; i < 3; i++) {
        try {
            geminiState.count++;
            if (geminiState.count >= 5 && geminiState.token) {
                geminiState.token = await getNewToken();
                geminiState.count = 0;
            }
            const headers = { ...GEMINI.HEADERS };
            if (geminiState.token) {
                headers["Authorization"] = `Bearer ${geminiState.token}`;
            }
            return await axios.post(url, payload, { headers });
        } catch (error) {
            lastError = error;
            if (isThrottled(error) && i < 2) {
                geminiState.token = await getNewToken();
                geminiState.count = 0;
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

// ============================================
// 4. SANITIZATION (Thought Signature)
// ============================================
function ensureThoughtSignature(part) {
    if (part.functionCall && !part.thoughtSignature) {
        return {
            ...part,
            thoughtSignature: "skip_thought_signature_validator"
        };
    }
    return part;
}

function sanitizeParts(parts) {
    if (!Array.isArray(parts)) return parts;
    return parts.map(ensureThoughtSignature);
}

function sanitizeHistory(history) {
    return history.map(entry => ({
        ...entry,
        parts: sanitizeParts(entry.parts)
    }));
}

// ============================================
// 5. MAIN CHAT FUNCTION
// ============================================
async function chat(messages = [], fileBuffer = null, customTools = []) {
    const msgArray = Array.isArray(messages)
        ? messages
        : typeof messages === "string"
        ? [{ role: "user", content: messages }]
        : [];

    const systemMsg = msgArray.find(m => m.role === "system");
    const systemInstructionText = systemMsg
        ? typeof systemMsg.content === "string"
            ? systemMsg.content
            : (systemMsg.parts?.[0]?.text ?? "")
        : undefined;

    const history = msgArray
        .filter(m => m.role !== "system")
        .map(m => ({
            role: m.role === "assistant" ? "model" : m.role || "user",
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

    const preparedHistory = sanitizeHistory(history);

    const payload = {
        contents: preparedHistory,
        tools: customTools.length > 0 ? [
                { functionDeclarations: customTools },
                { googleSearch: {} }
            ] : [
                { googleSearch: {} }
            ],
            toolConfig: {
                functionCallingConfig: { mode: "AUTO" },
                ...(customTools.length > 0 && { includeServerSideToolInvocations: true })
            },
        ...(systemInstructionText && {
            systemInstruction: {
                role: "system",
                parts: [{ text: systemInstructionText }]
            }
        }),
        generationConfig: {
            thinkingConfig: { thinkingLevel: "HIGH" },
            temperature: 1
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE"
            }
        ]
    };

    const { data } = await fetchGemini(
        `${GEMINI.URL}/${GEMINI.MODEL}:generateContent`,
        payload
    );

    const candidate = data?.candidates?.[0];
    const responseParts = candidate?.content?.parts;

    if (!responseParts || responseParts.length === 0) {
        const reason = candidate?.finishReason;
        throw new Error(
            reason && reason !== "STOP"
                ? `Respons diblokir safety filter (reason: ${reason})`
                : "Respons kosong dari AI"
        );
    }

    return responseParts
        .map(p => p.text || "")
        .join("")
        .trim();
}

export default chat;
