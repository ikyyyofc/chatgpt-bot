require("./config");
const baileys = require("@whiskeysockets/baileys");
const axios = require("axios");
const {
    default: makeWaSocket,
    useMultiFileAuthState,
    PHONENUMBER_MCC
} = baileys;
const Pino = require("pino"),
    fs = require("fs"),
    path = require("path"),
    colors = require("@colors/colors/safe");

const {
    connectDB,
    getOrCreateChat,
    updateChat
    //updateAllChatsSystemMessages
} = require("./database");
const { jsonFormat, simpleBind, isJSON } = require("./lib/simple");
const chatAI = require("./lib/vertex")
global.getOrCreateChat = getOrCreateChat;
global.updateChat = updateChat;

global.chatWithGPT = async (data_msg) => {
    try {
        const messages = [...defaultSystemMessages, ...data_msg];

        let answ = await chatAI(messages);
        if (!isJSON(answ)) return chatWithGPT(data_msg);
        return answ;
    } catch (er) {
        console.error(er);
    }
};
const plugins = {};

function loadPlugins() {
    const pluginDir = path.join(__dirname, "plugins");
    fs.readdirSync(pluginDir).forEach(file => {
        if (file.endsWith(".js")) {
            const pluginName = path.basename(file, ".js");
            plugins[pluginName] = require(path.join(pluginDir, file));
            console.log(`Plugin ${pluginName} telah dimuat.`);
        }
    });
}

loadPlugins();
const connect = async () => {
    await connectDB();
    // await updateAllChatsSystemMessages();
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
        //console.log(update);
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

        //console.log(text)
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
                                chatWithGPT(chat.conversations).then(
                                    response => {
                                        let out = JSON.parse(response);
                                        kyy.reply(
                                            m.key.remoteJid,
                                            jsonFormat(out.output),
                                            m
                                        ).then(a => {
                                            updateChat(chat, {
                                                role: "assistant",
                                                content: response
                                            }).then(() => {
                                                if (plugins[out.type]) {
                                                    plugins[out.type](
                                                        m,
                                                        out,
                                                        kyy,
                                                        a
                                                    );
                                                }
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