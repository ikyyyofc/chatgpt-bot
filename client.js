require("./config");
const baileys = require("@whiskeysockets/baileys");
const axios = require("axios");
const {
    default: makeWaSocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    PHONENUMBER_MCC
} = baileys;
const Pino = require("pino"),
    fs = require("fs"),
    colors = require("@colors/colors/safe"),
    { connectDB, getOrCreateChat, updateChat } = require("./database");
const { jsonFormat, simpleBind } = require("./lib/simple");

global.getOrCreateChat = getOrCreateChat;
global.updateChat = updateChat;
class Api_feature {
    constructor() {
        this.Nazuna = "https://api.nazuna.my.id/api/";
        this.Widipe = "https://api.tioo.eu.org/";
        this.Itzpire = "https://itzpire.com/";
        this.Yanzbotz = "https://api.yanzbotz.live/api/";
        this.Ikyy = "https://ikyy-bard.hf.space/";
    }

    yanzbotz = (endpoint, options = {}) => {
        const { data, ...params } = options;
        const method = data ? "POST" : "GET";
        if (method === "GET") {
            params.apiKey = "yanzdev";
        } else if (method === "POST") {
            data.apiKey = "yanzdev";
        }

        const config = {
            baseURL: this.Yanzbotz,
            url: endpoint,
            method: method,
            headers: {
                accept: "*/*"
            },
            ...(method === "GET" && { params: params }),
            ...(method === "POST" && { data: data })
        };

        return new Promise((resolve, reject) => {
            axios
                .request(config)
                .then(response => {
                    resolve(response.data);
                })
                .catch(e => {
                    if (e.response) {
                        resolve(e.response.data);
                    } else {
                        resolve(e);
                    }
                });
        });
    };
    // ... (Metode API lainnya tetap sama)
}
class VertexAI {
    constructor() {
        this.api_url = "https://firebasevertexai.googleapis.com/v1beta";
        this.model_url =
            "projects/gemmy-ai-bdc03/locations/us-central1/publishers/google/models";
        this.headers = {
            "content-type": "application/json",
            "x-goog-api-client": "gl-kotlin/2.1.0-ai fire/16.5.0",
            "x-goog-api-key": "AIzaSyD6QwvrvnjU7j-R6fkOghfIVKwtvc7SmLk"
        };
        this.ratio = ["1:1", "3:4", "4:3", "9:16", "16:9"];
        this.model = {
            search: [
                "gemini-2.0-flash",
                "gemini-2.0-flash-001",
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite-preview-06-17",
                "gemini-2.5-pro"
            ],
            chat: [
                "gemini-1.5-flash",
                "gemini-1.5-flash-002",
                "gemini-1.5-pro",
                "gemini-1.5-pro-002",
                "gemini-2.0-flash",
                "gemini-2.0-flash-001",
                "gemini-2.0-flash-lite",
                "gemini-2.0-flash-lite-001",
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite-preview-06-17",
                "gemini-2.5-pro"
            ],
            image: [
                "imagen-3.0-generate-002",
                "imagen-3.0-generate-001",
                "imagen-3.0-fast-generate-001",
                "imagen-3.0-capability-001",
                "imagen-4.0-generate-preview-06-06",
                "imagen-4.0-fast-generate-preview-06-06",
                "imagen-4.0-ultra-generate-preview-06-06"
            ]
        };
    }

    // Method lama tetap ada untuk backward compatibility
    async chat(
        question,
        {
            model = "gemini-1.5-flash",
            system_instruction = null,
            file_buffer = null,
            search = false
        } = {}
    ) {
        if (!question) throw new Error("Question is required");
        if (!this.model.chat.includes(model))
            throw new Error(`Available models: ${this.model.chat.join(", ")}`);
        if (search && !this.model.search.includes(model))
            throw new Error(
                `Available search models: ${this.model.search.join(", ")}`
            );

        const parts = [{ text: question }];
        if (file_buffer) {
            const { mime } = await fileTypeFromBuffer(file_buffer);
            parts.unshift({
                inlineData: {
                    mimeType: mime,
                    data: file_buffer.toString("base64")
                }
            });
        }

        const r = await axios.post(
            `${this.api_url}/${this.model_url}/${model}:generateContent`,
            {
                model: `${this.model_url}/${model}`,
                contents: [
                    ...(system_instruction
                        ? [
                              {
                                  role: "model",
                                  parts: [{ text: system_instruction }]
                              }
                          ]
                        : []),
                    {
                        role: "user",
                        parts: parts
                    }
                ],
                ...(search
                    ? {
                          tools: [
                              {
                                  googleSearch: {}
                              }
                          ]
                      }
                    : {})
            },
            {
                headers: this.headers
            }
        );

        if (r.status !== 200) throw new Error("No result found");
        return r.data.candidates;
    }

    // Method baru dengan format messages OpenAI-style
    async chatWithMessages(
        messages,
        { model = "gemini-1.5-flash", search = false } = {}
    ) {
        if (!messages || !Array.isArray(messages))
            throw new Error("Messages must be an array");
        if (!this.model.chat.includes(model))
            throw new Error(`Available models: ${this.model.chat.join(", ")}`);
        if (search && !this.model.search.includes(model))
            throw new Error(
                `Available search models: ${this.model.search.join(", ")}`
            );

        const contents = [];

        for (const message of messages) {
            let geminiRole;
            switch (message.role) {
                case "system":
                    // System message akan dimasukkan sebagai model response pertama
                    geminiRole = "model";
                    break;
                case "user":
                    geminiRole = "user";
                    break;
                case "assistant":
                    geminiRole = "model";
                    break;
                default:
                    throw new Error(
                        `Unsupported role: ${message.role}. Use 'system', 'user', or 'assistant'`
                    );
            }

            // Handle file buffer jika ada di content
            let parts = [];
            if (typeof message.content === "string") {
                parts = [{ text: message.content }];
            } else if (Array.isArray(message.content)) {
                // Support untuk multi-modal content
                for (const content of message.content) {
                    if (content.type === "text") {
                        parts.push({ text: content.text });
                    } else if (content.type === "image_url") {
                        // Jika ada base64 image
                        const base64Data = content.image_url.url.split(",")[1];
                        parts.push({
                            inlineData: {
                                mimeType:
                                    content.image_url.mime || "image/jpeg",
                                data: base64Data
                            }
                        });
                    }
                }
            } else {
                parts = [{ text: String(message.content) }];
            }

            contents.push({
                role: geminiRole,
                parts: parts
            });
        }

        const r = await axios.post(
            `${this.api_url}/${this.model_url}/${model}:generateContent`,
            {
                model: `${this.model_url}/${model}`,
                contents: contents,
                ...(search
                    ? {
                          tools: [
                              {
                                  googleSearch: {}
                              }
                          ]
                      }
                    : {})
            },
            {
                headers: this.headers
            }
        );

        if (r.status !== 200) throw new Error("No result found");
        return r.data.candidates;
    }

    async image(
        prompt,
        { model = "imagen-3.0-generate-002", aspect_ratio = "1:1" } = {}
    ) {
        if (!prompt) throw new Error("Prompt is required");
        if (!this.model.image.includes(model))
            throw new Error(`Available models: ${this.model.image.join(", ")}`);
        if (!this.ratio.includes(aspect_ratio))
            throw new Error(`Available ratios: ${this.ratio.join(", ")}`);

        const r = await axios.post(
            `${this.api_url}/${this.model_url}/${model}:predict`,
            {
                instances: [
                    {
                        prompt: prompt
                    }
                ],
                parameters: {
                    sampleCount: 1,
                    includeRaiReason: true,
                    aspectRatio: aspect_ratio,
                    safetySetting: "block_only_high",
                    personGeneration: "allow_adult",
                    addWatermark: false,
                    imageOutputOptions: {
                        mimeType: "image/jpeg",
                        compressionQuality: 100
                    }
                }
            },
            {
                headers: this.headers
            }
        );

        if (r.status !== 200) throw new Error("No result found");
        return r.data.predictions;
    }
}
global.Api = new Api_feature();

function isJSON(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

function extractAnswer(input, getAnalysis = false) {
    const regex = /<think>([\s\S]*?)<\/think>([\s\S]*)|([\s\S]*)/;
    const match = input.match(regex);

    if (getAnalysis) {
        return match[1]
            ? match[1].replace(/\n|\\n/g, " ").trim()
            : "No Thinking...";
    } else {
        return (match[2] || match[3]).trim();
    }
}

global.chatWithGPT = async (data_msg, newMsg) => {
    const messages = [...defaultSystemMessages, ...data_msg];
    try {
        const v = new VertexAI();
        const resp = await v.chatWithMessages(messages, {
            model: "gemini-2.5-pro",
            search: true
        });
        return resp[0].content.parts[resp[0].content.parts.length - 1].text;
    } catch (er) {
        console.error(er);
        return chatWithGPT(data_msg);
    }
};

const connect = async () => {
    await connectDB();
    console.log(colors.green("Connecting..."));
    const { state, saveCreds } = await useMultiFileAuthState("session");
    const config = JSON.parse(fs.readFileSync("./pairing.json", "utf-8"));

    const kyy = makeWaSocket({
        printQRInTerminal:
            config.pairing && config.pairing.state && config.pairing.number
                ? false
                : true,
        auth: state,
        browser: ["Chrome (Linux)", "", ""],
        logger: Pino({ level: "silent" })
    });
    simpleBind(kyy);

    if (
        config.pairing &&
        config.pairing.state &&
        !kyy.authState.creds.registered
    ) {
        var phoneNumber = config.pairing.number;
        if (
            !Object.keys(PHONENUMBER_MCC).some(v =>
                String(phoneNumber).startsWith(v)
            )
        ) {
            console.log(colors.red("Invalid phone number"));
            return;
        }
        setTimeout(async () => {
            try {
                let code = await kyy.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(colors.yellow("Pairing Code:" + code));
            } catch {}
        }, 3000);
    }

    kyy.ev.on("creds.update", saveCreds);
    kyy.ev.on("connection.update", async update => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            console.log(
                colors.green("Succesfully Connected With ") +
                    colors.cyan(kyy.user.name)
            );
        }
        if (connection === "close") {
            if (
                lastDisconnect?.output?.statusCode !==
                baileys.DisconnectReason.loggedOut
            )
                connect();
        }
    });

    kyy.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        const text =
            (
                m.message?.extendedTextMessage?.text ??
                m.message?.ephemeralMessage?.message?.extendedTextMessage
                    ?.text ??
                m.message?.conversation
            )?.toLowerCase() || "";

        if (m.key.remoteJid.endsWith("@g.us")) {
            setTimeout(() => {
                kyy.groupLeave(m.key.remoteJid);
            }, 5000);
        }

        if (!m.key.fromMe && !m.key.remoteJid.endsWith("@g.us")) {
            if (text !== "") {
                kyy.readMessages([m.key]).then(() => {
                    getOrCreateChat(m.key.remoteJid).then(chat => {
                        updateChat(chat, {
                            role: "user",
                            content: text
                        }).then(() => {
                            kyy.sendPresenceUpdate(
                                "composing",
                                m.key.remoteJid
                            ).then(() => {
                                chatWithGPT(chat.conversations, text).then(
                                    response => {
                                        kyy.reply(
                                            m.key.remoteJid,

                                            jsonFormat(response),
                                            m
                                        ).then(a => {
                                            updateChat(chat, {
                                                role: "assistant",
                                                content: response
                                            });
                                        });
                                    }
                                );
                            });
                        });
                    });
                });
            }
        }
    });

    kyy.ev.on("call", async call => {
        const { status, id, from } = call[0];
        if (status === "offer") {
            await kyy.rejectCall(id, from);
            await kyy.sendMessage(from, {
                text: "gausah call, nanti gw blok"
            });
        }
    });
};

connect().catch(() => connect());
