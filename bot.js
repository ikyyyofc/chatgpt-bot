// bot.js
require("./config");
const baileys = require("@whiskeysockets/baileys");
const {
    default: makeWaSocket,
    useMultiFileAuthState,
    PHONENUMBER_MCC,
    DisconnectReason,
    downloadMediaMessage
} = baileys;
const Pino = require("pino");
const fs = require("fs");
const path = require("path");
const colors = require("@colors/colors/safe");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

const config = require("./config");
const chatAI = require("./gemini");

// load semua plugin
const plugins = new Map();
const PLUGIN_DIR = path.join(__dirname, "plugins");

function loadPlugins() {
    try {
        if (!fs.existsSync(PLUGIN_DIR)) {
            fs.mkdirSync(PLUGIN_DIR);
            console.log(colors.yellow("📁 Created plugins directory"));
        }

        const files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith(".js"));
        
        for (const file of files) {
            try {
                const pluginPath = path.join(PLUGIN_DIR, file);
                delete require.cache[require.resolve(pluginPath)];
                
                const plugin = require(pluginPath);
                const pluginName = plugin.name || path.basename(file, ".js");
                
                if (plugin.execute) {
                    plugins.set(pluginName, {
                        name: pluginName,
                        description: plugin.description || "No description",
                        execute: plugin.execute
                    });
                    console.log(colors.green(`🔌 Loaded plugin: ${pluginName}`));
                } else {
                    console.log(colors.yellow(`⚠️  Skipped ${file}: no execute function`));
                }
            } catch (error) {
                console.error(colors.red(`❌ Failed to load plugin ${file}:`), error.message);
            }
        }

        console.log(colors.cyan(`✅ Total ${plugins.size} plugins loaded\n`));
    } catch (error) {
        console.error(colors.red("❌ Error loading plugins:"), error);
    }
}

// load session dari file
const SESSION_FILE = path.join(__dirname, "sessions.json");
let userSessions = new Map();

function loadSessions() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, "utf8");
            console.log(colors.yellow("📂 Loading sessions from file..."));
            userSessions = new Map(JSON.parse(data));
            console.log(colors.green(`✅ Loaded ${userSessions.size} user sessions\n`));
        }
    } catch (error) {
        console.error(colors.red("❌ Error load sessions:"), error);
    }
}

function saveSessions() {
    try {
        const data = JSON.stringify([...userSessions]);
        fs.writeFileSync(SESSION_FILE, data, "utf8");
        console.log(colors.green("💾 Sessions saved"));
    } catch (error) {
        console.error(colors.red("❌ Error save sessions:"), error);
    }
}

// parse response AI
function parseAIResponse(text) {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            
            if (parsed.type && parsed.output) {
                return {
                    isPlugin: true,
                    type: parsed.type,
                    input: parsed.input || "",
                    output: parsed.output,
                    rawResponse: text
                };
            }
        }
    } catch (e) {}
    
    return {
        isPlugin: false,
        output: text,
        rawResponse: text
    };
}

// tracking request yang lagi diproses per user
const processingRequests = new Map();
const messageQueues = new Map();

const connect = async () => {
    loadPlugins();
    loadSessions();
    
    console.log(colors.green("Connecting..."));
    const { state, saveCreds } = await useMultiFileAuthState("session");
    const pairingConfig = JSON.parse(fs.readFileSync("./pairing.json", "utf-8"));

    const sock = makeWaSocket({
        printQRInTerminal: pairingConfig.pairing?.state && pairingConfig.pairing?.number ? false : true,
        auth: state,
        browser: ["Chrome (Linux)", "", ""],
        logger: Pino({ level: "silent" })
    });

    if (pairingConfig.pairing?.state && !sock.authState.creds.registered) {
        const phoneNumber = pairingConfig.pairing.number;
        if (!Object.keys(PHONENUMBER_MCC).some(v => String(phoneNumber).startsWith(v))) {
            console.log(colors.red("Invalid phone number"));
            return;
        }
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(colors.yellow("Pairing Code: " + code));
            } catch {}
        }, 3000);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "open") {
            console.log(colors.green("Successfully Connected With ") + colors.cyan(sock.user.name));
        }
        
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log(colors.yellow("Connection closed, reconnecting..."));
                connect();
            } else {
                console.log(colors.red("Logged out!"));
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const sender = m.key.fromMe ? sock.user.id : (isGroup ? m.key.participant : from);
        const senderNumber = sender.split("@")[0];
        
        // extract text dari berbagai tipe message
        const text = (
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            m.message?.imageMessage?.caption ||
            m.message?.videoMessage?.caption ||
            m.message?.documentMessage?.caption ||
            ""
        );

        // skip kalo dari group
        if (isGroup) {
            setTimeout(() => {
                sock.groupLeave(from).catch(() => {});
            }, 5000);
            return;
        }

        // skip kalo dari bot sendiri
        if (m.key.fromMe) return;

        // handle command /reset
        if (text.trim() === "/reset") {
            console.log(colors.yellow(`\n🔄 /reset from ${senderNumber}`));
            userSessions.delete(from);
            saveSessions();
            await sock.sendMessage(from, { text: "oke, chat history udah direset! mulai dari awal yuk" });
            return;
        }

        // handle command /update (owner only)
        if (text.trim() === "/update") {
            if (senderNumber !== config.OWNER_NUMBER) {
                return; // skip, biar AI yang respon
            }

            console.log(colors.yellow(`\n🔄 /update from owner ${senderNumber}`));

            try {
                await sock.sendMessage(from, { text: "🔄 Pulling latest changes from git..." });

                const { stdout, stderr } = await execPromise("git pull");
                
                console.log("Git pull output:", stdout);
                if (stderr) console.log("Git pull errors:", stderr);

                console.log(colors.green("💾 Saving sessions before restart..."));
                saveSessions();

                await sock.sendMessage(from, { 
                    text: `✅ Update berhasil!\n🔄 Restarting bot...\n\n${stdout}` 
                });

                console.log(colors.green("🔄 Restarting bot...\n"));

                setTimeout(() => {
                    process.exit(0);
                }, 1000);

            } catch (error) {
                console.error(colors.red("❌ Update error:"), error);
                await sock.sendMessage(from, { 
                    text: `❌ Update gagal!\n\n${error.message}` 
                });
            }
            return;
        }

        // skip kalo ga ada text dan ga ada media
        const hasMedia = m.message?.imageMessage || m.message?.videoMessage || 
                        m.message?.documentMessage || m.message?.audioMessage;
        
        if (!text && !hasMedia) return;

        // kalo lagi ada request diproses, cancel request sebelumnya
        if (processingRequests.has(from)) {
            const oldController = processingRequests.get(from);
            oldController.cancelled = true;
            console.log(colors.yellow(`⚠️  Cancelling previous request from ${senderNumber}`));
        }

        console.log(colors.cyan(`\n📩 New message from ${senderNumber}`));
        if (text) console.log(colors.white(`   💬 "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`));

        // bikin controller baru buat request ini
        const requestController = { cancelled: false };
        processingRequests.set(from, requestController);

        // init queue kalo belum ada
        if (!messageQueues.has(from)) {
            messageQueues.set(from, []);
        }
        const queue = messageQueues.get(from);

        // tambahin message ke queue
        queue.push(m);

        try {
            // mark as read
            await sock.readMessages([m.key]);

            // typing indicator terus menerus sampe selesai
            let typingInterval = setInterval(() => {
                if (!requestController.cancelled) {
                    sock.sendPresenceUpdate("composing", from).catch(() => {});
                }
            }, 5000); // kirim typing tiap 5 detik

            // typing indicator
            await sock.sendPresenceUpdate("composing", from);

            // ambil atau buat session
            if (!userSessions.has(from)) {
                userSessions.set(from, []);
                console.log(colors.green(`   🆕 New user session created`));
            }
            
            const history = userSessions.get(from);
            console.log(colors.yellow(`   📚 History: ${history.length} messages`));

            // proses semua message di queue
            const messagesToProcess = [...queue];
            queue.length = 0;

            if (messagesToProcess.length > 1) {
                console.log(colors.yellow(`   📦 Processing ${messagesToProcess.length} queued messages`));
            }

            let fileBuffer = null;

            for (const message of messagesToProcess) {
                // cek kalo request udah dibatalin
                if (requestController.cancelled) {
                    console.log(colors.red(`   ❌ Request cancelled, stopping processing`));
                    clearInterval(typingInterval);
                    return;
                }

                const msgText = (
                    message.message?.conversation ||
                    message.message?.extendedTextMessage?.text ||
                    message.message?.imageMessage?.caption ||
                    message.message?.videoMessage?.caption ||
                    message.message?.documentMessage?.caption ||
                    ""
                );

                let userMessage = msgText;

                // cek kalo ada quoted message dengan media
                const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMsg) {
                    console.log(colors.blue(`   🔗 Processing quoted message`));
                    
                    if (quotedMsg.imageMessage) {
                        console.log(colors.green(`   📸 Quoted image detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                { message: quotedMsg },
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download quoted media:`, e.message));
                        }
                    } else if (quotedMsg.videoMessage) {
                        console.log(colors.green(`   🎥 Quoted video detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                { message: quotedMsg },
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download quoted media:`, e.message));
                        }
                    } else if (quotedMsg.documentMessage) {
                        console.log(colors.green(`   📄 Quoted document detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                { message: quotedMsg },
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download quoted media:`, e.message));
                        }
                    } else if (quotedMsg.audioMessage) {
                        console.log(colors.green(`   🎵 Quoted audio detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                { message: quotedMsg },
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download quoted media:`, e.message));
                        }
                    }
                }

                // kalo ga ada quoted, cek media di message sekarang
                if (!fileBuffer) {
                    if (message.message?.imageMessage) {
                        console.log(colors.green(`   📸 Image detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                message,
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download media:`, e.message));
                        }
                    } else if (message.message?.videoMessage) {
                        console.log(colors.green(`   🎥 Video detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                message,
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download media:`, e.message));
                        }
                    } else if (message.message?.documentMessage) {
                        console.log(colors.green(`   📄 Document detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                message,
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download media:`, e.message));
                        }
                    } else if (message.message?.audioMessage) {
                        console.log(colors.green(`   🎵 Audio detected`));
                        try {
                            const buffer = await downloadMediaMessage(
                                message,
                                'buffer',
                                {},
                                { logger: Pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            fileBuffer = buffer;
                        } catch (e) {
                            console.log(colors.red(`   ❌ Failed to download media:`, e.message));
                        }
                    }
                }

                // skip kalo ga ada text dan ga ada file
                if (!userMessage && !fileBuffer) continue;

                // tambahin message user ke history
                history.push({
                    role: "user",
                    content: userMessage
                });
            }

            // cek lagi sebelum proses AI
            if (requestController.cancelled) {
                console.log(colors.red(`   ❌ Request cancelled before AI processing`));
                clearInterval(typingInterval);
                return;
            }

            // limit history
            if (history.length > config.MAX_HISTORY) {
                const removed = history.length - config.MAX_HISTORY;
                history.splice(0, removed);
                console.log(colors.yellow(`   🗑️  Removed ${removed} old messages from history`));
            }

            console.log(colors.magenta(`   🤖 Calling AI...`));

            // buat system prompt dengan info plugin
            const pluginInfo = Array.from(plugins.values()).map(p => 
                `- ${p.name}: ${p.description}`
            ).join("\n");

            const enhancedSystemPrompt = config.SYSTEM_PROMPT + 
                (plugins.size > 0 ? `\n\nKamu punya akses ke plugin berikut:\n${pluginInfo}\n\n` +
                "Jika user minta sesuatu yang bisa dipake plugin, respond dengan JSON format:\n" +
                '{"type": "nama_plugin", "input": "parameter_yang_dibutuhin", "output": "pesan_ke_user"}' : "");

            const messagesWithSystem = [
                {
                    role: "system",
                    content: enhancedSystemPrompt
                },
                ...history
            ];

            // panggil AI dengan file buffer dari message terakhir
            const response = await chatAI(messagesWithSystem, fileBuffer);

            // cek sekali lagi sebelum kirim response
            if (requestController.cancelled) {
                console.log(colors.red(`   ❌ Request cancelled after AI response`));
                clearInterval(typingInterval);
                return;
            }

            console.log(colors.green(`   ✅ AI responded (${response.length} chars)`));

            // parse response
            const parsed = parseAIResponse(response);

            // tambahin response AI ke history
            history.push({
                role: "assistant",
                content: parsed.output
            });

            // save session
            saveSessions();

            // kirim response
            await sock.sendMessage(from, { text: parsed.output }, { quoted: m });
            console.log(colors.green(`   📤 Response sent to ${senderNumber}`));

            // stop typing indicator
            clearInterval(typingInterval);

            // eksekusi plugin kalo ada
            if (parsed.isPlugin && plugins.has(parsed.type)) {
                console.log(colors.blue(`   🔌 Executing plugin: ${parsed.type}`));
                
                // react hourglass pas lagi proses plugin
                await sock.sendMessage(from, {
                    react: {
                        text: '⏳',
                        key: m.key
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

                    // react success
                    await sock.sendMessage(from, {
                        react: {
                            text: '✅',
                            key: m.key
                        }
                    });

                    console.log(colors.green(`   ✅ Plugin executed successfully`));
                } catch (pluginError) {
                    console.error(colors.red(`   ❌ Plugin error:`), pluginError.message);
                    
                    // react error
                    await sock.sendMessage(from, {
                        react: {
                            text: '❌',
                            key: m.key
                        }
                    });
                    
                    await sock.sendMessage(from, { 
                        text: "waduh plugin error nih... tapi gapapa lanjut aja" 
                    });
                }
            }

            // hapus dari processing setelah selesai
            processingRequests.delete(from);
            console.log(colors.green(`   ✓ Request completed\n`));

        } catch (error) {
            console.error(colors.red("\n❌ Error:"), error.message);
            
            // stop typing indicator kalo error
            if (typeof typingInterval !== 'undefined') {
                clearInterval(typingInterval);
            }
            
            await sock.sendMessage(from, { 
                text: "waduh error nih... coba lagi deh atau ketik /reset buat mulai dari awal" 
            });
            processingRequests.delete(from);
            console.log(colors.red(`   ✗ Request failed\n`));
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

    // save session pas exit
    process.on("SIGINT", () => {
        console.log(colors.yellow("\n\n⏹️  Shutting down..."));
        console.log(colors.yellow("💾 Saving sessions..."));
        saveSessions();
        console.log(colors.green("👋 Bot stopped\n"));
        process.exit(0);
    });
};

connect().catch(() => connect());

console.log(colors.cyan("╔════════════════════════════════════════╗"));
console.log(colors.cyan("║   🤖 WhatsApp Bot is starting...     ║"));
console.log(colors.cyan("║   Press Ctrl+C to stop                ║"));
console.log(colors.cyan("╚════════════════════════════════════════╝\n"));