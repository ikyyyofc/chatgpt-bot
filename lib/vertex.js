const axios = require('axios');
const { fromBuffer } = require('file-type');

const API_URL = "https://firebasevertexai.googleapis.com/v1beta";
const MODEL_URL =
    "projects/gemmy-ai-bdc03/locations/us-central1/publishers/google/models";
const MODEL = "gemini-2.5-pro";
const HEADERS = {
    "content-type": "application/json",
    "x-goog-api-client": "gl-kotlin/2.1.0-ai fire/16.5.0",
    "x-goog-api-key": "AIzaSyD6QwvrvnjU7j-R6fkOghfIVKwtvc7SmLk"
};

/**
 *
 * @param {Array<{role: "system"|"user"|"assistant", content: string}>} messages
 * @param {Buffer|null} fileBuffer
 * @returns
 */
async function chat(messages = [], fileBuffer = null) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("Messages array is required");
    }

    // convert ke format vertex
    const contents = messages.map(msg => ({
        role: msg.role === "system" ? "model" : msg.role,
        parts: [{ text: msg.content }]
    }));

    // kalau ada file buffer, inject ke message terakhir user
    if (fileBuffer) {
        const type = await fromBuffer(fileBuffer);
        if (!type) throw new Error("Unable to detect file type");

        const inlinePart = {
            inlineData: {
                mimeType: type.mime,
                data: fileBuffer.toString("base64")
            }
        };

        // inject ke message terakhir yang role=user
        const lastUser = [...contents].reverse().find(m => m.role === "user");
        if (lastUser) {
            lastUser.parts.unshift(inlinePart);
        } else {
            // kalau ga ada user message, tambahin aja baru
            contents.push({
                role: "user",
                parts: [inlinePart]
            });
        }
    }

    const r = await axios.post(
        `${API_URL}/${MODEL_URL}/${MODEL}:generateContent`,
        {
            model: `${MODEL_URL}/${MODEL}`,
            contents,
            tools: [{ googleSearch: {} }] // search selalu aktif
        },
        { headers: HEADERS }
    );

    if (r.status !== 200) throw new Error("No result found");
    return r.data.candidates[0].content.parts.map(o => o.text).join("");
}

module.exports = chat