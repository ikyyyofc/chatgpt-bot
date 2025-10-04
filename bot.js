// bot.js
import './config.js';
import makeWASocket, { 
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import Pino from 'pino';
import fs from 'fs';
import path from 'path';
import colors from '@colors/colors/safe.js';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// dynamic import config dan gemini
const config = await import('./config.js').then(m => m.default);
const chatAI = await import('./gemini.js').then(m => m.default);

// load semua plugin
const plugins = new Map();
const PLUGIN_DIR = path.join(__dirname, 'plugins');

async function loadPlugins() {
    try {
        if (!fs.existsSync(PLUGIN_DIR)) {
            fs.mkdirSync(PLUGIN_DIR);
            console.log(colors.yellow('📁 Created plugins directory'));
        }

        const files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            try {
                const pluginPath = path.join(PLUGIN_DIR, file);
                const pluginUrl = `file://${pluginPath}?update=${Date.now()}`;
                
                const plugin = await import(pluginUrl).then(m => m.default);
                const pluginName = plugin.name || path.basename(file, '.js');
                
                if (plugin.execute) {
                    plugins.set(pluginName, {
                        name: pluginName,
                        description: plugin.description || 'No description',
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
        console.error(colors.red('❌ Error loading plugins:'), error);
    }
}

// load session dari file
const SESSION_FILE = path.join(__dirname, 'sessions.json');
let userSessions = new Map();

function loadSessions() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, 'utf8');
            console.log(colors.yellow('📂 Loading sessions from file...'));
            userSessions = new Map(JSON.parse(data));
            console.log(colors.green(`✅ Loaded ${userSessions.size} user sessions\n`));
        }
    } catch (error) {
        console.error(colors.red('❌ Error load sessions:'), error);
    }
}

function saveSessions() {
    try {
        const data = JSON.stringify([...userSessions]);
        fs.writeFileSync(SESSION_FILE, data, 'utf8');
        console.log(colors.green('💾 Sessions saved'));
    } catch (error) {
        console.error(colors.red('❌ Error save sessions:'), error);
    }
}

// parse response AI
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
            console.log(colors.red('   ⚠️  Invalid JSON structure, missing required fields'));
            
            return {
                isPlugin: false,
                type: 'chat',
                input: '',
                output: text,
                rawResponse: text
            };
        }
        
        const isPlugin = parsed.type !== 'chat' && plugins.has(parsed.type);
        
        return {
            isPlugin: isPlugin,
            type: parsed.type,
            input: parsed.input || '',
            output: parsed.output,
            rawResponse: text
        };
        
    } catch (e) {
        console.log(colors.red('   ⚠️  Failed to parse JSON:', e.message));
        console.log(colors.yellow('   📝 Raw response:', text));
        
        return {
            isPlugin: false,
            type: 'chat',
            input: '',
            output: text,
            rawResponse: text
        };
    }
}

// tracking request yang lagi diproses per user
const processingRequests = new Map();
const messageQueues = new Map();

// tracking bot startup time
let botStartTime = null;
let isReady = false;

// tracking activity untuk auto offline
let lastActivityTime = Date.now();
let isOnline = true;
let offlineTimer = null;

// config auto offline (dalam milidetik)
const AUTO_OFFLINE_DELAY = config.AUTO_OFFLINE_MINUTES * 60 * 1000;
const ONLINE_DELAY = config.ONLINE_DELAY_SECONDS * 1000;

// fungsi random delay
function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// fungsi hitung typing time berdasarkan panjang text
function calculateTypingTime(text) {
    const chars = text.length;
    const timeMs = (chars / config.TYPING_SPEED) * 1000;
    // min 2 detik, max 10 detik
    return Math.min(Math.max(timeMs, 2000), 10000);
}

async function setPresence(sock, status) {
    try {
        await sock.sendPresenceUpdate(status);
        isOnline = (status === 'available');
        console.log(colors.cyan(`📡 Presence set to: ${status}`));
    } catch (e) {}
}

// fungsi reset offline timer
function resetOfflineTimer(sock) {
    lastActivityTime = Date.now();
    
    if (offlineTimer) {
        clearTimeout(offlineTimer);
    }
    
    offlineTimer = setTimeout(() => {
        if (isOnline) {
            console.log(colors.yellow(`\n💤 No activity for ${AUTO_OFFLINE_DELAY / 60000} minutes, going offline...`));
            setPresence(sock, 'unavailable');
        }
    }, AUTO_OFFLINE_DELAY);
}

const connect = async () => {
    await loadPlugins();
    loadSessions();
    
    console.log(colors.green('Connecting...'));
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const pairingConfig = JSON.parse(fs.readFileSync('./pairing.json', 'utf-8'));

    const sock = makeWASocket({
        printQRInTerminal: pairingConfig.pairing?.state && pairingConfig.pairing?.number ? false : true,
        auth: state,
        browser: ['Chrome (Linux)', '', ''],
        logger: Pino({ level: 'silent' })
    });

    if (pairingConfig.pairing?.state && !sock.authState.creds.registered) {
        const phoneNumber = pairingConfig.pairing.number;
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(colors.yellow('Pairing Code: ' + code));
            } catch (e) {
                console.error(colors.red('Failed to get pairing code:', e.message));
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log(colors.green('Successfully Connected With ') + colors.cyan(sock.user.name));
            
            botStartTime = Date.now();
            console.log(colors.yellow('⏳ Waiting 1 minute before processing messages...'));
            
            await setPresence(sock, 'available');
            resetOfflineTimer(sock);
            
            setTimeout(() => {
                isReady = true;
                console.log(colors.green('✅ Bot is ready to process messages!\n'));
            }, 60000);
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log(colors.yellow('Connection closed, reconnecting...'));
                isReady = false;
                botStartTime = null;
                isOnline = false;
                
                if (offlineTimer) {
                    clearTimeout(offlineTimer);
                    offlineTimer = null;
                }
                
                connect();
            } else {
                console.log(colors.red('Logged out!'));
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = m.key.fromMe ? sock.user.id : (isGroup ? m.key.participant : from);
        const senderNumber = sender.split('@')[0];
        
        let text = (
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            m.message?.imageMessage?.caption ||
            m.message?.videoMessage?.caption ||
            m.message?.documentMessage?.caption ||
            ''
        );

        if (m.key.fromMe) return;

        // handle grup
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const ownerInGroup = participants.some(p => p.id.split('@')[0] === config.OWNER_NUMBER);
                
                if (!ownerInGroup) {
                    console.log(colors.yellow(`👥 Owner not in group ${groupMetadata.subject}, leaving...`));
                    setTimeout(() => {
                        sock.groupLeave(from).catch(() => {});
                    }, 3000);
                    return;
                }
                
                // cek apakah bot di-tag
                const mentionedJid = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const isBotMentioned = mentionedJid.includes(botNumber);
                
                if (!isBotMentioned) {
                    // gak di-tag, abaikan
                    return;
                }
                
                console.log(colors.cyan(`\n👥 Group message from ${senderNumber} in ${groupMetadata.subject}`));
                console.log(colors.green(`   ✅ Bot mentioned, processing...`));
                
                // hapus mention bot dari teks
                const botMention = `@${sock.user.id.split(':')[0]}`;
                text = text.replace(new RegExp(botMention, 'g'), '').trim();
                
                // replace mention user lain dengan nama mereka
                if (mentionedJid.length > 0) {
                    for (const jid of mentionedJid) {
                        if (jid === botNumber) continue; // skip bot mention
                        
                        const mentionNumber = jid.split('@')[0];
                        const participant = participants.find(p => p.id === jid);
                        
                        let name = mentionNumber;
                        try {
                            // coba ambil nama dari kontak
                            const contactName = participant?.notify || participant?.name;
                            if (contactName) {
                                name = contactName;
                            }
                        } catch (e) {
                            // fallback ke nomor
                        }
                        
                        // replace @nomor dengan nama
                        text = text.replace(new RegExp(`@${mentionNumber}`, 'g'), name);
                    }
                }
                
                console.log(colors.white(`   💬 Cleaned text: "${text}"`));
                
            } catch (error) {
                console.error(colors.red('Error checking group:'), error.message);
                return;
            }
        }

        if (text.trim() === '/reset') {
            const messageTimestamp = m.messageTimestamp * 1000;
            if (!isReady || messageTimestamp < botStartTime) {
                console.log(colors.gray(`⏭️  Skipping old /reset command from ${senderNumber}`));
                return;
            }
            
            // reset gak work di grup
            if (isGroup) {
                console.log(colors.yellow(`   ⚠️  /reset ignored in group`));
                return;
            }
            
            console.log(colors.yellow(`\n🔄 /reset from ${senderNumber}`));
            userSessions.delete(from);
            saveSessions();
            await sock.sendMessage(from, { text: 'oke, chat history udah direset! mulai dari awal yuk' });
            return;
        }

        if (text.trim() === '/update') {
            const messageTimestamp = m.messageTimestamp * 1000;
            if (!isReady || messageTimestamp < botStartTime) {
                console.log(colors.gray(`⏭️  Skipping old /update command from ${senderNumber}`));
                return;
            }
            
            if (senderNumber !== config.OWNER_NUMBER) {
                return;
            }

            console.log(colors.yellow(`\n🔄 /update from owner ${senderNumber}`));

            try {
                await sock.sendMessage(from, { text: '🔄 Pulling latest changes from git...' });

                const { stdout, stderr } = await execPromise('git pull');
                
                console.log('Git pull output:', stdout);
                if (stderr) console.log('Git pull errors:', stderr);

                console.log(colors.green('💾 Saving sessions before restart...'));
                saveSessions();

                await sock.sendMessage(from, { 
                    text: `✅ Update berhasil!\n🔄 Restarting bot...\n\n${stdout}` 
                });

                console.log(colors.green('🔄 Restarting bot...\n'));

                setTimeout(() => {
                    process.exit(0);
                }, 1000);

            } catch (error) {
                console.error(colors.red('❌ Update error:'), error);
                await sock.sendMessage(from, { 
                    text: `❌ Update gagal!\n\n${error.message}` 
                });
            }
            return;
        }

        const hasMedia = m.message?.imageMessage || m.message?.videoMessage || 
                        m.message?.documentMessage || m.message?.audioMessage;
        
        if (!text && !hasMedia) return;

        // delay sebelum baca pesan (1-3 detik) - biar keliatan natural
        const [minRead, maxRead] = config.DELAY_BEFORE_READ;
        await randomDelay(minRead, maxRead);
        console.log(colors.gray(`   ⏱️  Waited ${Math.floor((Date.now() - m.messageTimestamp * 1000) / 1000)}s before reading`));

        await sock.readMessages([m.key]);

        // === DELAY SETELAH BACA SEBELUM NGETIK ===
        const [minThink, maxThink] = config.DELAY_BEFORE_TYPING || [2000, 5000];
        const thinkDelay = Math.floor(Math.random() * (maxThink - minThink + 1)) + minThink;
        await new Promise(resolve => setTimeout(resolve, thinkDelay));
        console.log(colors.gray(`   💭 Thinking for ${thinkDelay / 1000}s before typing...`));

        if (!isOnline) {
            console.log(colors.yellow(`\n🌐 Bot is offline, going online for ${senderNumber}...`));
            await new Promise(resolve => setTimeout(resolve, ONLINE_DELAY));
            await setPresence(sock, 'available');
            console.log(colors.green(`✅ Bot is now online`));
        }

        resetOfflineTimer(sock);

        if (!isReady) {
            console.log(colors.gray(`⏳ Waiting for bot to be ready before processing message from ${senderNumber}...`));
            
            while (!isReady) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log(colors.green(`✅ Bot ready, processing message from ${senderNumber}`));
        }

        if (processingRequests.has(from)) {
            const oldController = processingRequests.get(from);
            oldController.cancelled = true;
            console.log(colors.yellow(`⚠️  Cancelling previous request from ${senderNumber}`));
        }

        console.log(colors.cyan(`\n📩 New message from ${senderNumber}`));
        if (text) console.log(colors.white(`   💬 "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`));

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
                    sock.sendPresenceUpdate('composing', from).catch(() => {});
                }
            }, 5000);

            await sock.sendPresenceUpdate('composing', from);

            // session history cuma untuk private chat
            let history = [];
            if (!isGroup) {
                if (!userSessions.has(from)) {
                    userSessions.set(from, []);
                    console.log(colors.green(`   🆕 New user session created`));
                }
                
                history = userSessions.get(from);
                console.log(colors.yellow(`   📚 History: ${history.length} messages`));
            } else {
                console.log(colors.yellow(`   👥 Group chat - no history saved`));
            }

            const messagesToProcess = [...queue];
            queue.length = 0;

            if (messagesToProcess.length > 1) {
                console.log(colors.yellow(`   📦 Processing ${messagesToProcess.length} queued messages`));
            }

            let fileBuffer = null;

            for (const message of messagesToProcess) {
                if (requestController.cancelled) {
                    console.log(colors.red(`   ❌ Request cancelled, stopping processing`));
                    clearInterval(typingInterval);
                    return;
                }

                let msgText = (
                    message.message?.conversation ||
                    message.message?.extendedTextMessage?.text ||
                    message.message?.imageMessage?.caption ||
                    message.message?.videoMessage?.caption ||
                    message.message?.documentMessage?.caption ||
                    ''
                );

                // kalo dari grup, udah dibersihkan di atas (text variable)
                if (isGroup) {
                    msgText = text;
                }

                let userMessage = msgText;

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

                if (!userMessage && !fileBuffer) continue;

                history.push({
                    role: 'user',
                    content: userMessage
                });
            }

            if (requestController.cancelled) {
                console.log(colors.red(`   ❌ Request cancelled before AI processing`));
                clearInterval(typingInterval);
                return;
            }

            if (!isGroup && history.length > config.MAX_HISTORY) {
                const removed = history.length - config.MAX_HISTORY;
                history.splice(0, removed);
                console.log(colors.yellow(`   🗑️  Removed ${removed} old messages from history`));
            }

            console.log(colors.magenta(`   🤖 Calling AI...`));

            const pluginInfo = Array.from(plugins.values()).map(p => 
                `- ${p.name}: ${p.description}`
            ).join('\n');

            const enhancedSystemPrompt = config.SYSTEM_PROMPT + 
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
${plugins.size > 0 ? pluginInfo : 'Tidak ada plugin tersedia'}

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
                    role: 'system',
                    content: enhancedSystemPrompt
                },
                ...history
            ];

            const response = await chatAI(messagesWithSystem, fileBuffer);

            if (requestController.cancelled) {
                console.log(colors.red(`   ❌ Request cancelled after AI response`));
                clearInterval(typingInterval);
                return;
            }

            console.log(colors.green(`   ✅ AI responded (${response.length} chars)`));

            const parsed = parseAIResponse(response);

            // cuma save ke history kalo bukan grup
            if (!isGroup) {
                history.push({
                    role: 'assistant',
                    content: parsed.output
                });

                saveSessions();
            }

            // === KIRIM PESAN BOT DAN SIMPAN KEY-NYA ===
            const botMessage = await sock.sendMessage(from, { text: parsed.output }, { quoted: m });
            console.log(colors.green(`   📤 Response sent to ${senderNumber}`));

            clearInterval(typingInterval);

            if (parsed.isPlugin && plugins.has(parsed.type)) {
                console.log(colors.blue(`   🔌 Executing plugin: ${parsed.type}`));
                
                // === REACT DI PESAN BOT, BUKAN USER ===
                await sock.sendMessage(from, {
                    react: {
                        text: '⏳',
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
                            text: '✅',
                            key: botMessage.key
                        }
                    });

                    console.log(colors.green(`   ✅ Plugin executed successfully`));
                } catch (pluginError) {
                    console.error(colors.red(`   ❌ Plugin error:`), pluginError.message);
                    
                    await sock.sendMessage(from, {
                        react: {
                            text: '❌',
                            key: botMessage.key
                        }
                    });
                    
                    await sock.sendMessage(from, { 
                        text: 'waduh plugin error nih... tapi gapapa lanjut aja' 
                    });
                }
            }

            processingRequests.delete(from);
            console.log(colors.green(`   ✓ Request completed\n`));

        } catch (error) {
            console.error(colors.red('\n❌ Error:'), error.message);
            
            if (typeof typingInterval !== 'undefined') {
                clearInterval(typingInterval);
            }
            
            await sock.sendMessage(from, { 
                text: 'waduh error nih... coba lagi deh atau ketik /reset buat mulai dari awal' 
            });
            processingRequests.delete(from);
            console.log(colors.red(`   ✗ Request failed\n`));
        }
    });

    sock.ev.on('call', async call => {
        const { status, id, from } = call[0];
        if (status === 'offer') {
            await sock.rejectCall(id, from);
            await sock.sendMessage(from, {
                text: 'gausah call, nanti gw blok'
            });
        }
    });

    process.on('SIGINT', () => {
        console.log(colors.yellow('\n\n⏹️  Shutting down...'));
        console.log(colors.yellow('💾 Saving sessions...'));
        saveSessions();
        console.log(colors.green('👋 Bot stopped\n'));
        process.exit(0);
    });
};

connect().catch(() => connect());

console.log(colors.cyan('╔════════════════════════════════════════╗'));
console.log(colors.cyan('║   🤖 WhatsApp Bot is starting...     ║'));
console.log(colors.cyan('║   Press Ctrl+C to stop                ║'));
console.log(colors.cyan('╚════════════════════════════════════════╝\n'));