// bot.js
import './config.js';
import makeWASocket, { 
    useMultiFileAuthState,
    PHONENUMBER_MCC,
    DisconnectReason,
    downloadMediaMessage
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

// fungsi set presence
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
        if (!Object.keys(PHONENUMBER_MCC).some(v => String(phoneNumber).startsWith(v))) {
            console.log(colors.red('Invalid phone number'));
            return;
        }
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(colors.yellow('Pairing Code: ' + code));
            } catch {}
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
        
        const text = (
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            m.message?.imageMessage?.caption ||
            m.message?.videoMessage?.caption ||
            m.message?.documentMessage?.caption ||
            ''
        );

        if (isGroup) {
            setTimeout(() => {
                sock.groupLeave(from).catch(() => {});
            }, 5000);
            return;
        }

        if (m.key.fromMe) return;

        if (text.trim() === '/reset') {
            const messageTimestamp = m.messageTimestamp * 1000;
            if (!isReady || messageTimestamp < botStartTime) {
                console.log(colors.gray(`⏭️  Skipping old /reset command from ${senderNumber}`));
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

        await sock.readMessages([m.key]);

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

            if (!userSessions.has(from)) {
                userSessions.set(from, []);
                console.log(colors.green(`   🆕 New user session created`));
            }
            
            const history = userSessions.get(from);
            console.log(colors.yellow(`   📚 History: ${history.length} messages`));

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

                const msgText = (
                    message.message?.conversation ||
                    message.message?.extendedTextMessage?.text ||
                    message.message?.imageMessage?.caption ||
                    message.message?.videoMessage?.caption ||
                    message.message?.documentMessage?.caption ||
                    ''
                );

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

            if (history.length > config.MAX_HISTORY) {
                const removed = history.length - config.MAX_HISTORY;
                history.splice(0, removed);
                console.log(colors.yellow(`   🗑️  Removed ${removed} old messages from history`));
            }

            console.log(colors.magenta(`   🤖 Calling AI...`));

            const pluginInfo = Array.from(plugins.values()).map(p => 
                `- ${p.name}: ${p.description}`
            ).join('\n');

            const enhancedSystemPrompt = config.SYSTEM_PROMPT + 
                `\n\n=== ATURAN WAJIB RESPONSE ===
SETIAP response KAMU HARUS dalam format JSON yang valid. TIDAK ADA PENGECUALIAN!

Format JSON wajib:
{"type": "...", "input": "...", "output": "..."}

Penjelasan field:
- "type": nama plugin yang akan dieksekusi, atau "chat" jika tidak butuh plugin
- "input": parameter/data yang dibutuhkan plugin (kosongkan string jika type="chat")
- "output": pesan yang akan diterima user, harus natural dan ramah

ATURAN KETAT:
1. WAJIB respond dengan JSON valid di setiap response
2. Jika user meminta sesuatu yang bisa dilakukan plugin, gunakan type sesuai nama plugin
3. Jika chat biasa tanpa butuh plugin, gunakan type="chat"
4. Field "output" adalah komunikasi ke user, buat natural dan engaging
5. JANGAN PERNAH hanya berjanji atau bilang "akan saya lakukan" - LANGSUNG set type plugin yang sesuai
6. Plugin akan OTOMATIS dieksekusi setelah kamu respond, jadi pastikan type sudah benar
7. RESPOND LANGSUNG dengan JSON, tanpa markdown code block atau wrapper apapun

Plugin yang tersedia:
${plugins.size > 0 ? pluginInfo : 'Tidak ada plugin tersedia'}

PENTING:
- Setiap kali user request action yang bisa dilakukan plugin, PASTI gunakan type plugin tersebut
- Jangan cuma acknowledge request di output, tapi pastikan type sudah set dengan benar
- Plugin akan auto-execute jika type sesuai dengan nama plugin yang ada
- Untuk chat biasa (greeting, tanya jawab umum, dll), gunakan type="chat"`;

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

            history.push({
                role: 'assistant',
                content: parsed.output
            });

            saveSessions();

            await sock.sendMessage(from, { text: parsed.output }, { quoted: m });
            console.log(colors.green(`   📤 Response sent to ${senderNumber}`));

            clearInterval(typingInterval);

            if (parsed.isPlugin && plugins.has(parsed.type)) {
                console.log(colors.blue(`   🔌 Executing plugin: ${parsed.type}`));
                
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

                    await sock.sendMessage(from, {
                        react: {
                            text: '✅',
                            key: m.key
                        }
                    });

                    console.log(colors.green(`   ✅ Plugin executed successfully`));
                } catch (pluginError) {
                    console.error(colors.red(`   ❌ Plugin error:`), pluginError.message);
                    
                    await sock.sendMessage(from, {
                        react: {
                            text: '❌',
                            key: m.key
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