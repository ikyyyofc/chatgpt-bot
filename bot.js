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

import { sendButtons, sendInteractiveMessage } from "./lib/button.js";

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
                        command: plugin.command || [],
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

let saveTimeout = null;
function saveSessions() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const data = JSON.stringify([...userSessions]);
            await fs.promises.writeFile(SESSION_FILE, data, "utf8");
        } catch (error) {
            console.error(colors.red("❌ Save error:"), error);
        }
    }, 5000);
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

let isFirstLoad = true;
const connect = async () => {
    if (isFirstLoad) {
        await loadPlugins();
        loadSessions();
        isFirstLoad = false;
    }
    const { version, isLatest } = await fetchLatestWaWebVersion();

    console.log(colors.green("Connecting..."));
    let state, saveCreds;
    try {
        const auth = await useMultiFileAuthState(config.SESSION);
        state = auth.state;
        saveCreds = auth.saveCreds;
    } catch (err) {
        console.error(colors.red("❌ Session file corrupted. Deleting session and retrying..."));
        fs.rmSync(`./${config.SESSION}`, { recursive: true, force: true });
        return connect();
    }

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

            const errorMsg = lastDisconnect?.error?.message?.toLowerCase() || "";
            const isBadSession = 
                statusCode === 500 || 
                errorMsg.includes("bad mac") || 
                errorMsg.includes("invalid mac") ||
                errorMsg.includes("decrypt") ||
                errorMsg.includes("corrupted");

            if (reason === DisconnectReason.loggedOut || statusCode === 401 || isBadSession) {
                console.log(colors.red(isBadSession ? "❌ Session corrupted / Invalid MAC" : "❌ Logged out / Session expired"));
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
        if (m.key.id.startsWith("3EB0")) return;

        global.lastMessage = m;

        /*const from = m.key.remoteJid;
        if (from.startsWith("status@broadcast"))
            sock.sendMessage(config.OWNER_NUMBER + "@s.whatsapp.net", {
                text: util.inspect(m, { depth: 2 })
            });*/
        const remoteJid = m.key.remoteJid || "";
        const isStatus = remoteJid.startsWith("status@broadcast");
        const isGroup = remoteJid.endsWith("@g.us");
        if (isStatus) return;

        const from = remoteJid;
        const sender = m.key.fromMe
            ? sock.user.id.split(":")[0] + "@s.whatsapp.net"
            : isGroup
              ? m.key.participantAlt
              : m.key.remoteJidAlt || remoteJid;
        const senderNumber = sender ? sender.split("@")[0] : "";

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
            text.trim().startsWith(".") ||
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

            if (command === ".bot") {
                if (!userIsOwner) return;
                async function displayFilesInFolder(folderPath, options = {}) {
                    const fs = await import("fs/promises");
                    const path = await import("path");

                    const defaultSkipDirs = ["node_modules", ".git", "dist"];
                    const defaultSkipFiles = [
                        "package-lock.json",
                        ".gitignore"
                    ];

                    const {
                        skipDirs = [],
                        skipFiles = [],
                        fileExtensions = null,
                        excludeExtensions = null
                    } = options;

                    const allSkipDirs = [
                        ...new Set([...defaultSkipDirs, ...skipDirs])
                    ];
                    const allSkipFiles = [
                        ...new Set([...defaultSkipFiles, ...skipFiles])
                    ];

                    // Helper function untuk convert glob pattern ke regex
                    function globToRegex(pattern) {
                        // Escape special regex characters kecuali * dan ?
                        const escaped = pattern
                            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                            .replace(/\*/g, ".*") // * = match any characters
                            .replace(/\?/g, "."); // ? = match single character
                        return new RegExp(`^${escaped}$`);
                    }

                    // Helper function untuk check apakah nama match dengan patterns
                    function matchesPattern(name, patterns) {
                        return patterns.some(pattern => {
                            // Kalau pattern mengandung * atau ?, treat sebagai glob pattern
                            if (
                                pattern.includes("*") ||
                                pattern.includes("?")
                            ) {
                                const regex = globToRegex(pattern);
                                return regex.test(name);
                            }
                            // Kalau tidak, exact match
                            return name === pattern;
                        });
                    }

                    let result = "";

                    async function readFilesRecursively(dir, basePath = "") {
                        const items = await fs.readdir(dir);

                        for (const item of items) {
                            const fullPath = path.join(dir, item);
                            const relativePath = path.join(basePath, item);
                            const stats = await fs.stat(fullPath);

                            if (stats.isDirectory()) {
                                if (!matchesPattern(item, allSkipDirs)) {
                                    await readFilesRecursively(
                                        fullPath,
                                        relativePath
                                    );
                                }
                            } else if (stats.isFile()) {
                                if (matchesPattern(item, allSkipFiles)) {
                                    continue;
                                }

                                const ext = path.extname(item);

                                if (
                                    excludeExtensions &&
                                    excludeExtensions.includes(ext)
                                ) {
                                    continue;
                                }

                                if (
                                    !fileExtensions ||
                                    fileExtensions.includes(ext)
                                ) {
                                    const content = await fs.readFile(
                                        fullPath,
                                        "utf8"
                                    );
                                    result += "—".repeat(100) + "\n";
                                    result +=
                                        "—".repeat(relativePath.length + 3) +
                                        "\n";
                                    result += `${relativePath}:\n`;
                                    result +=
                                        "—".repeat(relativePath.length + 3) +
                                        "\n";
                                    result += content;
                                    result += "\n" + "—".repeat(100) + "\n\n";
                                }
                            }
                        }
                    }

                    try {
                        await readFilesRecursively(folderPath);
                        return result;
                    } catch (error) {
                        throw new Error(
                            `Error reading folder: ${error.message}`
                        );
                    }
                }

                async function addPrompt() {
                    return await displayFilesInFolder("./", {
                        skipDirs: [
                            "session",
                            "plugins",
                            ".*",
                            "tmp",
                            "temp",
                            "src"
                        ],
                        excludeExtensions: [
                            ".md",
                            ".gitignore",
                            ".gitkeep",
                            ".py",
                            ".db",
                            ".db-journal"
                        ],
                        skipFiles: [
                            "README.md",
                            "package-lock.json",
                            "help",
                            "participant_store.json",
                            ".gitkeep",
                            ".gitignore",
                            "sessions.json"
                        ]
                    });
                }

                const aiResponseObj = await chatAI([
                    {
                        role: "system",
                        content:
                            (await addPrompt()) +
                            "\n\ngunakan file-file diatas sebagai referensi dan selalu cek dokumentasi terbaru dari https://www.npmjs.com/package/@whiskeysockets/baileys?activeTab=readme versi 7.x.x dan https://baileys.wiki/docs/migration/to-v7.0.0\npastikan selalu update dan sesuai dengan dokumentasi terbaru" +
                            "\n\njika membuat kode, ingatlah untuk membuat kode yang simpel, efisien, dan minimalis tetapi fungsinya jelas dan terstruktur dengan baik, tidak perlu memberikan tanda komentar dan feedback ke user pada kode yang dibuat, selalu gunakan blok markdown (```<kode>```) pada kode yang dibuat dan kode yang dibuat harus tipe ESM."
                    },
                    { role: "user", content: text.slice(4).trim() }
                ]);
                const responseText = aiResponseObj.text || "";
                
                function extractAllCodeBlocks(text) {
                    const regex = /```(.*?)```/gs;
                    const matches = text.matchAll(regex);

                    const allCode = [...matches].map(match => {
                        let code = match[1].trim();

                        // Cek baris pertama, kalo cuma 1 kata (biasanya nama bahasa) hapus
                        const lines = code.split("\n");
                        const firstLine = lines[0].trim();

                        // Kalo baris pertama cuma 1 kata tanpa spasi dan ga ada simbol kode,
                        // anggep itu nama bahasa, hapus
                        if (
                            lines.length > 1 &&
                            firstLine &&
                            !firstLine.includes(" ") &&
                            !firstLine.includes("(") &&
                            !firstLine.includes("{") &&
                            !firstLine.includes("=") &&
                            !firstLine.includes(";")
                        ) {
                            // Hapus baris pertama, ambil sisanya
                            return lines.slice(1).join("\n").trim();
                        }

                        return code;
                    });

                    return allCode;
                }
                let copy = [];

                if (responseText) {
                    let code = extractAllCodeBlocks(responseText);
                    if (code.length) {
                        for (let i in code) {
                            await copy.push({
                                name: "cta_copy",
                                buttonParamsJson: JSON.stringify({
                                    display_text:
                                        "Kode ke-" + (parseInt(i) + 1),
                                    copy_code: code[i]
                                })
                            });
                        }
                    }

                    sendInteractiveMessage(
                        sock,
                        m.key.remoteJid,
                        {
                            text: jsonFormat(responseText),
                            footer: "AI ini dibuat khusus untuk pengembangan bot",
                            interactiveButtons: copy.length
                                ? copy
                                : [
                                      {
                                          name: "cta_url",
                                          buttonParamsJson: JSON.stringify({
                                              display_text:
                                                  "Gada code yang mau di copy",
                                              url: "https://lynk.id/ikyyofc"
                                          })
                                      }
                                  ]
                        },
                        {
                            quoted: m
                        }
                    );
                    return;
                } else {
                    console.error(
                        "AI mengembalikan kesalahan atau tidak ada hasil:",
                        response.data
                    );
                    return;
                }
                return;
            }

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
    history = [
        { role: "assistant", content: "hai kak, sv aku yaa" },
        ...userSessions.get(from)
    ];
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
            
            const customTools = [];
            for (const plugin of plugins.values()) {
                customTools.push({
                    name: plugin.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64),
                    description: plugin.description || `Plugin ${plugin.name}`,
                    parameters: plugin.parameters || {
                        type: "OBJECT",
                        properties: {
                            input: {
                                type: "STRING",
                                description: "Parameter untuk plugin ini"
                            },
                            output: {
                                type: "STRING",
                                description: "Pesan yang ingin disampaikan ke user ketika plugin ini dijalankan"
                            }
                        },
                        required: ["output"]
                    }
                });
            }

            const enhancedSystemPrompt = config.SYSTEM_PROMPT;

            const messagesWithSystem = [
                {
                    role: "system",
                    content: enhancedSystemPrompt
                },
                ...history
            ];

            const response = await chatAI(messagesWithSystem, fileBuffer, customTools);

            if (requestController.cancelled) {
                clearInterval(typingInterval);
                return;
            }

            console.log(colors.green(`✅ AI`));

            let isPlugin = false;
            let pluginType = "chat";
            let pluginInput = "";
            let outputText = "";

            if (response.isFunctionCall) {
                isPlugin = true;
                pluginType = response.name;
                const args = response.args || {};
                pluginInput = args.input || "";
                outputText = args.output || args.output_message || args.pesan || "Tunggu sebentar ya...";
            } else {
                outputText = response.text || "";
            }

            if (!isGroup) {
                history.push({
                    role: "assistant",
                    content: outputText
                });

                saveSessions();
            }

            const botMessage = await sock.sendMessage(
                from,
                { text: outputText },
                { quoted: isGroup || isStatus ? m : null }
            );
            console.log(colors.green(`📤 Sent\n`));

            clearInterval(typingInterval);

            if (isPlugin && plugins.has(pluginType)) {
                console.log(colors.yellow(`⚡ Executing plugin: ${pluginType}`));
                try {
                    const plugin = plugins.get(pluginType);
                    if (plugin) {
                        await plugin.execute({
                            sock,
                            m,
                            from,
                            sender: senderNumber,
                            input: pluginInput,
                            args: response.args,
                            message: botMessage,
                            fileBuffer
                        });
                        console.log(colors.green(`✅ Plugin ${pluginType} executed successfully`));
                    }
                } catch (error) {
                    console.error(colors.red(`❌ Error in plugin ${pluginType}:`), error);
                    await sock.sendMessage(
                        from,
                        { text: `Oops, terjadi kesalahan saat menjalankan perintah: ${error.message}` },
                        { quoted: botMessage }
                    );
                }
            }

            processingRequests.delete(from);
            messageQueues.delete(from);
        } catch (error) {
            console.error(colors.red("❌ Error:"), error.message);

            if (typeof typingInterval !== "undefined") {
                clearInterval(typingInterval);
            }

            processingRequests.delete(from);
            messageQueues.delete(from);
        }
    });

   /* sock.ev.on("call", async call => {
        const { status, id, from } = call[0];
        if (status === "offer") {
            await sock.rejectCall(id, from);
            await sock.sendMessage(from, {
                text: "gausah call, nanti gw blok"
            });
        }
    });*/

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
