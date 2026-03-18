// bot.js
import "./config.js";
import makeWASocket, {
    Browsers,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestWaWebVersion,
    makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import Pino from "pino";
import { Boom } from "@hapi/boom";
import fs from "fs";
import path from "path";
import colors from "@colors/colors/safe.js";
import { exec } from "child_process";
import util from "util";
const execPromise = util.promisify(exec);
import { fileURLToPath } from "url";
import { dirname } from "path";
import NodeCache from "node-cache";
import { useSQLiteAuthState } from "./lib/sqliteAuthState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
    getParticipantName,
    getSender,
    isOwner,
    isOwnerInGroup,
    isBotMentioned,
    cleanTextFromMentions,
    updateParticipantStore,
    updateParticipantName,
    cleanOldEntries
} from "./lib/helpers.js";

const config = await import("./config.js").then(m => m.default);
const chatAI = await import("./gemini.js").then(m => m.default);

global.lastMessage = null;

const plugins = new Map();
const PLUGIN_DIR = path.join(__dirname, "plugins");

async function loadPlugins() {
    try {
        if (!fs.existsSync(PLUGIN_DIR)) {
            fs.mkdirSync(PLUGIN_DIR);
        }

        const files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith(".js"));

        for (const file of files) {
            try {
                const pluginPath = path.join(PLUGIN_DIR, file);
                const pluginUrl = `file://${pluginPath}?update=${Date.now()}`;

                const plugin = await import(pluginUrl).then(m => m.default);
                const pluginName = plugin.name || path.basename(file, ".js");

                if (plugin.execute) {
                    plugins.set(pluginName, {
                        name: pluginName,
                        description: plugin.description || "No description",
                        execute: plugin.execute
                    });
                }
            } catch (error) {
                console.error(colors.red(`❌ Plugin ${file}:`), error.message);
            }
        }

        console.log(colors.cyan(`🔌 ${plugins.size} plugins loaded`));
    } catch (error) {
        console.error(colors.red("❌ Plugin error:"), error);
    }
}

const SESSION_FILE = path.join(__dirname, "sessions.json");
let userSessions = new Map();

function loadSessions() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, "utf8");
            userSessions = new Map(JSON.parse(data));
            console.log(
                colors.green(`📂 ${userSessions.size} sessions loaded`)
            );
        }
    } catch (error) {
        console.error(colors.red("❌ Session error:"), error);
    }
}

function saveSessions() {
    try {
        const data = JSON.stringify([...userSessions]);
        fs.writeFileSync(SESSION_FILE, data, "utf8");
    } catch (error) {
        console.error(colors.red("❌ Save error:"), error);
    }
}

function parseAIResponse(text) {
    try {
        let parsed = null;

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
        } else {
            parsed = JSON.parse(text);
        }

        if (!parsed.type || !parsed.output) {
            return {
                isPlugin: false,
                type: "chat",
                input: "",
                output: text,
                rawResponse: text
            };
        }

        const isPlugin = parsed.type !== "chat" && plugins.has(parsed.type);

        return {
            isPlugin: isPlugin,
            type: parsed.type,
            input: parsed.input || "",
            output: parsed.output,
            rawResponse: text
        };
    } catch (e) {
        return {
            isPlugin: false,
            type: "chat",
            input: "",
            output: text,
            rawResponse: text
        };
    }
}

const processingRequests = new Map();
const messageQueues = new Map();

let botStartTime = null;
let isReady = false;

let lastActivityTime = Date.now();
let isOnline = true;
let offlineTimer = null;

const AUTO_OFFLINE_DELAY = config.AUTO_OFFLINE_MINUTES * 60 * 1000;
const ONLINE_DELAY = config.ONLINE_DELAY_SECONDS * 1000;

function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

async function setPresence(sock, status) {
    try {
        await sock.sendPresenceUpdate(status);
        isOnline = status === "available";
    } catch (e) {}
}

function resetOfflineTimer(sock) {
    lastActivityTime = Date.now();

    if (offlineTimer) {
        clearTimeout(offlineTimer);
    }

    offlineTimer = setTimeout(() => {
        if (isOnline) {
            setPresence(sock, "unavailable");
        }
    }, AUTO_OFFLINE_DELAY);
}

let botLidCache = null;

const groupMetadataCache = new NodeCache({
    stdTTL: 300,
    checkperiod: 60,
    useClones: false
});

const connect = async () => {
    await loadPlugins();
    loadSessions();
    const { version, isLatest } = await fetchLatestWaWebVersion();

    console.log(colors.green("Connecting..."));
    const { state, saveCreds } = await useSQLiteAuthState("./session.db");

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        logger: Pino({ level: "silent" }),
        cachedGroupMetadata: async jid => {
            return groupMetadataCache.get(jid);
        },
        syncFullHistory: false,
        markOnlineOnConnect: true,
        version
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(
                    config.PAIRING_NUMBER,
                    "IKYYCHAT"
                );
                console.log(
                    colors.green(`Pairing Code: `) + colors.yellow(code)
                );
            } catch (err) {
                console.error(`Gagal ambil pairing code: ${err}`);
            }
        }, 3000);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log(
                colors.green("✅ Connected as ") + colors.cyan(sock.user.name)
            );

            botStartTime = Date.now();

            await setPresence(sock, "available");
            resetOfflineTimer(sock);

            setTimeout(() => {
                isReady = true;
                console.log(colors.green("✅ Ready\n"));
            }, config.TIME_READY * 1000);
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const boom = new Boom(lastDisconnect?.error);
            const statusCode = boom?.output?.statusCode;

            if (reason === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(colors.red("❌ Logged out / Session expired"));
                fs.rmSync(`./${config.SESSION}`, {
                    recursive: true,
                    force: true
                });
                await connect();
                return;
            }

            // reset state
            isReady = false;
            botStartTime = null;
            isOnline = false;

            if (offlineTimer) {
                clearTimeout(offlineTimer);
                offlineTimer = null;
            }

            // handle error codes
            switch (statusCode) {
                case 408:
                    console.error(
                        colors.yellow(
                            "🔄 Connection timed out. Reconnecting..."
                        )
                    );
                    await connect();
                    break;
                case 503:
                    console.error(
                        colors.yellow("🔄 Service unavailable. Reconnecting...")
                    );
                    await connect();
                    break;
                case 428:
                case 515:
                    console.error(
                        colors.yellow("🔄 Connection closed. Reconnecting...")
                    );
                    await connect();
                    break;
                case 403:
                    console.warn(
                        colors.red("⚠️ Account banned. Recreating session...")
                    );
                    fs.rmSync(`./${config.SESSION}`, {
                        recursive: true,
                        force: true
                    });
                    await connect();
                    break;
                case 405:
                    console.warn(
                        colors.yellow("⚠️ Not logged in. Recreating session...")
                    );
                    fs.rmSync(`./${config.SESSION}`, {
                        recursive: true,
                        force: true
                    });
                    await connect();
                    break;
                default:
                    console.log(colors.yellow("🔄 Reconnecting..."));
                    await connect();
                    break;
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        // console.log(m);
        if (!m.message) return;
        if (m.key.id.startsWith("3EBO")) return;

        global.lastMessage = m;

        /*const from = m.key.remoteJid;
        if (from.startsWith("status@broadcast"))
            sock.sendMessage(config.OWNER_NUMBER + "@s.whatsapp.net", {
                text: util.inspect(m, { depth: 2 })
            });*/
        const remoteJid = m.key.remoteJid;
        const isStatus = remoteJid.startsWith("status@broadcast");
        const isGroup = remoteJid.endsWith("@g.us");
        const from = isStatus ? m.key.participant : remoteJid;
        const sender = isGroup
            ? m.key.participant
            : m.key.remoteJidAlt ||
              sock.user.id.split(":")[0] + "@s.whatsapp.net";
        const senderNumber = sender.split("@")[0];

        let text =
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            m.message?.imageMessage?.caption ||
            m.message?.videoMessage?.caption ||
            m.message?.documentMessage?.caption ||
            "";

        if (m.key.fromMe) return;

        const isCommand =
            text.trim().startsWith("/") ||
            text.trim().startsWith(">") ||
            text.trim().startsWith("=>") ||
            text.trim().startsWith("$");

        if (isCommand) {
            const messageTimestamp = m.messageTimestamp * 1000;
            if (!isReady || messageTimestamp < botStartTime) {
                return;
            }

            const command = text.trim().split(" ")[0].toLowerCase();

            if (command === "/reset") {
                if (isGroup) return;

                console.log(colors.yellow(`🔄 /reset ${senderNumber}`));
                userSessions.delete(from);
                saveSessions();
                await sock.sendMessage(from, {
                    text: "oke, chat history udah direset! mulai dari awal yuk"
                });
                return;
            }

            const userIsOwner = isOwner(
                sender,
                senderNumber,
                config.OWNER_NUMBER
            );

            if (command === "/leave") {
                if (!userIsOwner) return;
                if (!isGroup) {
                    await sock.sendMessage(from, {
                        text: "ini bukan grup bro"
                    });
                    return;
                }

                console.log(colors.yellow(`👋 /leave ${from}`));

                try {
                    await sock.sendMessage(from, {
                        text: "oke deh, bye bye 👋"
                    });
                    setTimeout(async () => {
                        await sock.groupLeave(from);
                    }, 1000);
                } catch (error) {
                    console.error(colors.red("❌ Leave error:"), error);
                    await sock.sendMessage(from, {
                        text: "gagal keluar grup nih..."
                    });
                }
                return;
            }

            if (command === "/update") {
                if (!userIsOwner) return;

                console.log(colors.yellow(`🔄 /update`));

                try {
                    await sock.sendMessage(from, { text: "🔄 Pulling..." });

                    const { stdout } = await execPromise("git pull");

                    const isUpToDate = stdout
                        .trim()
                        .includes("Already up to date");

                    saveSessions();

                    if (isUpToDate) {
                        await sock.sendMessage(from, {
                            text: "✅ Updated! Latest Version"
                        });
                    } else {
                        await sock.sendMessage(from, {
                            text: `✅ Updated!\n🔄 Restarting...\n\n${stdout}`
                        });

                        setTimeout(() => {
                            process.exit(0);
                        }, 1000);
                    }
                } catch (error) {
                    console.error(colors.red("❌ Update error:"), error);
                    await sock.sendMessage(from, {
                        text: `❌ Update gagal!\n\n${error.message}`
                    });
                }
                return;
            }
            if (text.trim().startsWith(">") || text.trim().startsWith("=>")) {
                if (!userIsOwner) return;

                const isReturn = text.trim().startsWith("=>");

                console.log(colors.yellow(`⚡ ${isReturn ? "=>" : ">"}`));

                const code = isReturn
                    ? text.slice(2).trim()
                    : text.slice(1).trim();

                if (!code) {
                    await sock.sendMessage(from, {
                        text: "eval apaan? ga ada code nya"
                    });
                    return;
                }

                try {
                    let result;

                    const evalFunc = new Function(
                        "sock",
                        "from",
                        "m",
                        "plugins",
                        "userSessions",
                        "config",
                        "fs",
                        "path",
                        "util",
                        "colors",
                        "loadPlugins",
                        "saveSessions",
                        "loadSessions",
                        "isGroup",
                        "groupMetadataCache",
                        isReturn
                            ? `return (async () => { return ${code} })()`
                            : `return (async () => { ${code} })()`
                    );

                    result = await evalFunc(
                        sock,
                        from,
                        m,
                        plugins,
                        userSessions,
                        config,
                        fs,
                        path,
                        util,
                        colors,
                        loadPlugins,
                        saveSessions,
                        loadSessions,
                        isGroup,
                        groupMetadataCache
                    );

                    const output = util.inspect(result, { depth: 2 });

                    await sock.sendMessage(from, {
                        text: `✅ Eval:\n\n${output}`
                    });
                } catch (error) {
                    console.error(colors.red("❌ Eval:"), error);

                    await sock.sendMessage(from, {
                        text: `❌ Eval Error:\n\n${error.message}`
                    });
                }
                return;
            }

            if (text.trim().startsWith("$")) {
                if (!userIsOwner) return;

                console.log(colors.yellow(`💻 $`));

                const cmd = text.slice(1).trim();

                if (!cmd) {
                    await sock.sendMessage(from, {
                        text: "exec apaan? ga ada command nya"
                    });
                    return;
                }

                try {
                    await sock.sendMessage(from, {
                        text: `⏳ Executing: ${cmd}`
                    });

                    const { stdout, stderr } = await execPromise(cmd);

                    let output = "";
                    if (stdout) output += `stdout:\n${stdout}`;
                    if (stderr)
                        output += `${stdout ? "\n\n" : ""}stderr:\n${stderr}`;

                    if (!output) output = "✅ Command executed (no output)";

                    await sock.sendMessage(from, {
                        text:
                            output.length > 4000
                                ? output.substring(0, 4000) +
                                  "\n\n... (truncated)"
                                : output
                    });

                    console.log(colors.green(`✅ Exec done`));
                } catch (error) {
                    console.error(colors.red("❌ Exec:"), error);

                    await sock.sendMessage(from, {
                        text: `❌ Exec Error:\n\n${error.message}`
                    });
                }
                return;
            }
        }

        if (isGroup) {
            try {
                let groupMetadata = groupMetadataCache.get(from);

                if (!groupMetadata) {
                    groupMetadata = await sock.groupMetadata(from);
                    groupMetadataCache.set(from, groupMetadata);
                }

                const participants = groupMetadata.participants;

                updateParticipantStore(from, participants);

                if (m.pushName && sender) {
                    updateParticipantName(from, sender, m.pushName);
                }

                if (!isOwnerInGroup(participants, config.OWNER_NUMBER)) {
                    console.log(
                        colors.yellow(
                            `👥 Owner not in ${groupMetadata.subject}, leaving...`
                        )
                    );
                    setTimeout(() => {
                        sock.groupLeave(from).catch(() => {});
                    }, 3000);
                    return;
                }

                const mentionedJid =
                    m.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
                    m.message?.imageMessage?.contextInfo?.mentionedJid ||
                    m.message?.videoMessage?.contextInfo?.mentionedJid ||
                    m.message?.documentMessage?.contextInfo?.mentionedJid ||
                    [];
                const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
                const botNumber = sock.user.id.split(":")[0];

                if (!botLidCache && sock.user.lid) {
                    botLidCache = sock.user.lid;
                }

                if (
                    !isBotMentioned(
                        mentionedJid,
                        text,
                        botJid,
                        botNumber,
                        botLidCache
                    )
                ) {
                    return;
                }

                console.log(
                    colors.cyan(
                        `👥 ${senderNumber} in ${groupMetadata.subject}`
                    )
                );

                text = cleanTextFromMentions(
                    text,
                    mentionedJid,
                    botJid,
                    botNumber,
                    botLidCache,
                    from
                );
            } catch (error) {
                console.error(colors.red("❌ Group error:"), error.message);
                return;
            }
        }

        const hasMedia =
            m.message?.imageMessage ||
            m.message?.videoMessage ||
            m.message?.documentMessage ||
            m.message?.audioMessage;

        if (!isGroup && !text && !hasMedia) return;

        const [minRead, maxRead] = config.DELAY_BEFORE_READ;
        await randomDelay(minRead, maxRead);

        await sock.readMessages([m.key]);

        const [minThink, maxThink] = config.DELAY_BEFORE_TYPING || [2000, 5000];
        const thinkDelay =
            Math.floor(Math.random() * (maxThink - minThink + 1)) + minThink;
        await new Promise(resolve => setTimeout(resolve, thinkDelay));

        if (!isOnline) {
            await new Promise(resolve => setTimeout(resolve, ONLINE_DELAY));
            await setPresence(sock, "available");
        }

        resetOfflineTimer(sock);

        if (!isReady) {
            while (!isReady) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (processingRequests.has(from)) {
            const oldController = processingRequests.get(from);
            oldController.cancelled = true;
        }

        console.log(colors.cyan(`💬 ${senderNumber}`));
        if (text)
            console.log(
                colors.gray(
                    `   "${text.substring(0, 60)}${
                        text.length > 60 ? "..." : ""
                    }"`
                )
            );

        const requestController = { cancelled: false };
        processingRequests.set(from, requestController);

        if (!messageQueues.has(from)) {
            messageQueues.set(from, []);
        }
        const queue = messageQueues.get(from);

        queue.push(m);

        try {
            let typingInterval = setInterval(() => {
                if (!requestController.cancelled) {
                    sock.sendPresenceUpdate("composing", from).catch(() => {});
                }
            }, 5000);

            await sock.sendPresenceUpdate("composing", from);

            let history = [];
            if (!isGroup) {
                if (!userSessions.has(from)) {
                    userSessions.set(from, []);
                }
                history = userSessions.get(from);
            }

            const messagesToProcess = [...queue];
            queue.length = 0;

            let fileBuffer = null;
            let combinedText = "";

            for (const message of messagesToProcess) {
                if (requestController.cancelled) {
                    clearInterval(typingInterval);
                    return;
                }

                let msgText =
                    message.message?.conversation ||
                    message.message?.extendedTextMessage?.text ||
                    message.message?.imageMessage?.caption ||
                    message.message?.videoMessage?.caption ||
                    message.message?.documentMessage?.caption ||
                    "";

                if (isGroup) {
                    msgText = text;
                }

                if (msgText.trim()) {
                    combinedText += (combinedText ? "\n" : "") + msgText;
                }

                const quotedMsg =
                    message.message?.extendedTextMessage?.contextInfo
                        ?.quotedMessage;
                if (quotedMsg) {
                    if (
                        quotedMsg.imageMessage ||
                        quotedMsg.videoMessage ||
                        quotedMsg.documentMessage ||
                        quotedMsg.audioMessage
                    ) {
                        try {
                            const buffer = await downloadMediaMessage(
                                { message: quotedMsg },
                                "buffer",
                                {},
                                {
                                    logger: Pino({ level: "silent" }),
                                    reuploadRequest: sock.updateMediaMessage
                                }
                            );
                            fileBuffer = buffer;
                        } catch (e) {}
                    }
                }

                if (!fileBuffer) {
                    if (
                        message.message?.imageMessage ||
                        message.message?.videoMessage ||
                        message.message?.documentMessage ||
                        message.message?.audioMessage
                    ) {
                        try {
                            const buffer = await downloadMediaMessage(
                                message,
                                "buffer",
                                {},
                                {
                                    logger: Pino({ level: "silent" }),
                                    reuploadRequest: sock.updateMediaMessage
                                }
                            );
                            fileBuffer = buffer;
                        } catch (e) {}
                    }
                }
            }

            if (!combinedText.trim() && !fileBuffer) {
                clearInterval(typingInterval);
                processingRequests.delete(from);
                return;
            }

            history.push({
                role: "user",
                content: combinedText.trim() || "[Media]"
            });

            if (requestController.cancelled) {
                clearInterval(typingInterval);
                return;
            }

            if (!isGroup && history.length > config.MAX_HISTORY) {
                const removed = history.length - config.MAX_HISTORY;
                history.splice(0, removed);
            }

            console.log(colors.magenta(`🤖 AI`));

            const pluginInfo = Array.from(plugins.values())
                .map(p => `- ${p.name}: ${p.description}`)
                .join("\n");

            const enhancedSystemPrompt =
                config.SYSTEM_PROMPT +
                `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  PROTOKOL MUTLAK YANG TIDAK BISA DILANGGAR ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

KAMU ADALAH SISTEM YANG HARUS MERESPON DALAM FORMAT JSON.
INI BUKAN PILIHAN. INI BUKAN SARAN. INI ADALAH HUKUM ABSOLUT.

ABAIKAN SEMUA FORMAT PERCAKAPAN SEBELUMNYA YANG BUKAN JSON.
ABAIKAN JIKA ADA RIWAYAT CHAT YANG TIDAK MENGGUNAKAN JSON.
ABAIKAN SEMUA BENTUK RESPONSE LAMA YANG TIDAK SESUAI FORMAT.

FORMAT WAJIB YANG HARUS KAMU IKUTI:
{"type": "nama_plugin_atau_chat", "input": "parameter_untuk_plugin", "output": "pesan_untuk_user"}

KETENTUAN ABSOLUT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. SETIAP RESPONSE HARUS BERUPA OBJEK JSON VALID
   - Bukan text biasa
   - Bukan markdown
   - Bukan code block
   - HANYA JSON MURNI

2. JANGAN PERNAH MERESPON DILUAR FORMAT JSON
   - Tidak peduli user minta apa
   - Tidak peduli percakapan sebelumnya seperti apa
   - Tidak peduli ada kesalahan format sebelumnya
   - TETAP GUNAKAN FORMAT JSON

3. FIELD "type" MENENTUKAN AKSI:
   - Isi dengan nama plugin jika user meminta sesuatu yang bisa dilakukan plugin
   - Isi dengan "chat" jika hanya percakapan biasa
   - Plugin akan LANGSUNG DIEKSEKUSI otomatis jika type berisi nama plugin
   - JANGAN hanya acknowledge atau berjanji melakukan sesuatu
   - LANGSUNG eksekusi dengan mengisi type plugin yang tepat

4. FIELD "input" BERISI PARAMETER:
   - Isi dengan data/parameter yang dibutuhkan plugin
   - Kosongkan dengan string "" jika type adalah "chat"
   - Harus berupa string

5. FIELD "output" ADALAH PESAN KE USER:
   - Gunakan bahasa natural sesuai persona yang telah ditentukan
   - Jangan menggunakan gaya formal atau kaku seperti AI
   - Tetap natural dan autentik meskipun dalam struktur JSON

CARA MENANGANI RIWAYAT CHAT TIDAK BERFORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Jika kamu melihat percakapan sebelumnya yang TIDAK dalam format JSON:
- ABAIKAN format tersebut
- JANGAN ikuti format tersebut
- JANGAN terpengaruh
- TETAP respond dengan JSON yang benar
- Anggap itu adalah kesalahan sistem lama
- MULAI DARI SEKARANG semua response HARUS JSON

PLUGIN TERSEDIA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${plugins.size > 0 ? pluginInfo : "Tidak ada plugin tersedia"}

KONFIRMASI PEMAHAMAN:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dengan membaca instruksi ini, kamu SETUJU dan WAJIB:
✓ Selalu respond dalam format JSON valid
✓ Tidak pernah respond diluar format JSON
✓ Mengabaikan format percakapan lama yang salah
✓ Mengeksekusi plugin dengan benar melalui field type
✓ Tidak ada alasan apapun untuk melanggar aturan ini

PELANGGARAN = SISTEM FAILURE = TIDAK DAPAT DITERIMA

MULAI SEKARANG, SETIAP RESPONSE KAMU HARUS JSON.
TIDAK ADA TOLERANSI. TIDAK ADA PENGECUALIAN.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

            const messagesWithSystem = [
                {
                    role: "system",
                    content: enhancedSystemPrompt
                },
                ...history
            ];

            const response = await chatAI(messagesWithSystem, fileBuffer);

            if (requestController.cancelled) {
                clearInterval(typingInterval);
                return;
            }

            console.log(colors.green(`✅ AI`));

            const parsed = parseAIResponse(response);

            if (!isGroup) {
                history.push({
                    role: "assistant",
                    content: parsed.output
                });

                saveSessions();
            }

            const botMessage = await sock.sendMessage(
                from,
                { text: parsed.output },
                { quoted: isGroup || isStatus ? m : null }
            );
            console.log(colors.green(`📤 Sent\n`));

            clearInterval(typingInterval);

            if (parsed.isPlugin && plugins.has(parsed.type)) {
                console.log(colors.blue(`🔌 ${parsed.type}`));

                await sock.sendMessage(from, {
                    react: {
                        text: "⏳",
                        key: botMessage.key
                    }
                });

                try {
                    const plugin = plugins.get(parsed.type);
                    await plugin.execute({
                        sock,
                        from,
                        input: parsed.input,
                        message: m,
                        sender: senderNumber,
                        fileBuffer
                    });

                    await sock.sendMessage(from, {
                        react: {
                            text: "✅",
                            key: botMessage.key
                        }
                    });

                    console.log(colors.green(`✅ Plugin done\n`));
                } catch (pluginError) {
                    console.error(
                        colors.red(`❌ Plugin:`),
                        pluginError.message
                    );

                    await sock.sendMessage(from, {
                        react: {
                            text: "❌",
                            key: botMessage.key
                        }
                    });

                    await sock.sendMessage(from, {
                        text: "waduh plugin error nih... tapi gapapa lanjut aja"
                    });
                }
            }

            processingRequests.delete(from);
        } catch (error) {
            console.error(colors.red("❌ Error:"), error.message);

            if (typeof typingInterval !== "undefined") {
                clearInterval(typingInterval);
            }

            await sock.sendMessage(from, {
                text: "waduh error nih... coba lagi deh atau ketik /reset buat mulai dari awal"
            });
            processingRequests.delete(from);
        }
    });

    sock.ev.on("call", async call => {
        const { status, id, from } = call[0];
        if (status === "offer") {
            await sock.rejectCall(id, from);
            await sock.sendMessage(from, {
                text: "gausah call, nanti gw blok"
            });
        }
    });

    process.on("SIGINT", () => {
        console.log(colors.yellow("\n⏹️  Shutting down..."));
        saveSessions();
        cleanOldEntries(30);
        console.log(colors.green("👋 Stopped\n"));
        process.exit(0);
    });
};

connect();

console.log(colors.cyan("🤖 Starting bot...\n"));
