// plugins/sticker.js
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

module.exports = {
    description: 'Bikin sticker dari gambar',
    
    async execute({ sock, from, input, message, sender, fileBuffer }) {
        try {
            if (!fileBuffer) {
                await sock.sendMessage(from, { text: 'kirim atau quote foto/video yang mau dijadiin sticker!' });
                return false;
            }

            console.log(`   🎨 Creating sticker...`);

            // bikin sticker
            const sticker = new Sticker(fileBuffer, {
                pack: 'Bot Sticker',
                author: sender,
                type: StickerTypes.FULL,
                quality: 50
            });

            const buffer = await sticker.toBuffer();

            // kirim sticker
            await sock.sendMessage(from, {
                sticker: buffer
            }, { quoted: message });
            
            console.log(`   ✅ Sticker sent to ${sender}`);
            return true;

        } catch (error) {
            console.error(`   ❌ Sticker plugin error:`, error.message);
            await sock.sendMessage(from, { text: 'gagal bikin sticker nih...' });
            return false;
        }
    }
};