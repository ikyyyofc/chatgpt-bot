// config.js
module.exports = {
    // nomor owner (tanpa @s.whatsapp.net, contoh: 628123456789)
    OWNER_NUMBER: '6287866255637', // ganti dengan nomor lu
    
    // system prompt buat ngatur behavior bot
    SYSTEM_PROMPT: 'Kamu adalah asisten AI yang helpful, ramah, dan santai. Jawab dengan bahasa yang natural dan easy going.',
    
    // max history message per user (100 message = sekitar 50 bolak-balik)
    MAX_HISTORY: 100,
    
    // max file size buat diproses (bytes) - default 20MB
    MAX_FILE_SIZE: 20 * 1024 * 1024
};