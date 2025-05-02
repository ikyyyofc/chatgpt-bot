require("./config");
const baileys = require("@whiskeysockets/baileys");
const ai = require("unlimited-ai");
const axios = require("axios");
const {
    default: makeWaSocket,
    useMultiFileAuthState,
    PHONENUMBER_MCC
} = baileys;
const Pino = require("pino"),
    fs = require("fs"),
    {
        connectDB,
        getOrCreateChat,
        updateChat
    } = require("./database");
const { jsonFormat, simpleBind } = require("./lib/simple");
const gemini = require("./lib/gemini");
const OpenAI = require("openai");

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.apiKey
});
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
        return match[1] ? match[1].replace(/\n|\\n/g, " ").trim() : "No Thinking...";
    } else {
        return (match[2] || match[3]).trim();
    }
}

global.chatWithGPT = async (data_msg, newMsg) => {
    const messages = [...defaultSystemMessages, ...data_msg];
    try {
        const model = "deepseek-ai/DeepSeek-R1";

        let answ = await (
            await fetch("https://fastrestapis.fasturl.cloud/aillm/deepseek", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    messages,
                    model
                })
            })
        ).json();
        if (answ.status !== 200) return chatWithGPT(messages);
        if (!isJSON(extractAnswer(answ.result.choices[0].message.content)))
            return chatWithGPT(messages);
        if (
            typeof extractAnswer(answ.result.choices[0].message.content) ===
                "undefined" ||
            typeof extractAnswer(answ.result.choices[0].message.content) ===
                undefined ||
            extractAnswer(answ.result.choices[0].message.content) === "undefined"
        )
            return chatWithGPT(messages);
        
        return answ.result.choices[0].message.content;
    } catch (er) {
        console.error(er);
        return chatWithGPT(messages);
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
                                const msgnew = chat.conversations.map(
                                    ({ role, content }) => ({ role, content })
                                );

                                chatWithGPT(msgnew, text).then(response => {
                                    let answer = extractAnswer(response);
                                    let out = JSON.parse(answer);
                                    let think = extractAnswer(response, true);
                                    kyy.reply(
                                        m.key.remoteJid,
                                        jsonFormat(`> ${think}\n\n${out.output}`),
                                        m
                                    ).then(a => {
                                        updateChat(chat, {
                                            role: "assistant",
                                            content: response
                                        });
                                    });
                                });
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