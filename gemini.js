import axios from "axios";
import up from "./lib/uploadImage.js";
async function chat(messages = [], fileBuffer = null) {
    // Ekstrak system message
    const systemMsg = messages.find(m => m.role === "system");
    const system_instruction = systemMsg
        ? (typeof systemMsg.content === "string"
            ? systemMsg.content
            : systemMsg.parts?.[0]?.text ?? "")
        : undefined;

    // Filter non-system, normalize format
    const history = messages
        .filter(m => m.role !== "system")
        .map(m => ({
            role: m.role === "assistant" ? "model" : m.role,
            parts: typeof m.content === "string"
                ? [{ text: m.content }]
                : m.parts ?? [{ text: "" }]
        }));

    const payload = {
        action: "chat",
        messages: history,
        search: true,
        model: "gemini-3.1-pro-preview",
        ...(system_instruction && { system_instruction })
    };

    if (fileBuffer) {
      let imgUrl = await up(fileBuffer)
        payload.image_url = imgUrl;
        console.log(imgUrl)
    }

    const { data } = await axios.post("https://wudysoft.xyz/api/ai/gemini/v10", payload, {
        headers: { "Content-Type": "application/json" }
    });

    return data.result.text;
}

export default chat;
