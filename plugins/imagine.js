// plugins/imagine.js
const axios = require('axios');

module.exports = {
    description: 'Generate gambar dari text pake AI',
    
    async execute({ sock, from, input, message, sender }) {
        try {
            if (!input) {
                await sock.sendMessage(from, { text: 'kasih prompt nya dong! contoh: cat in space' });
                return false;
            }

            console.log(`   🎨 Generating image with prompt: ${input}`);

            // react processing
            await sock.sendMessage(from, {
                react: {
                    text: '🎨',
                    key: message.key
                }
            });

            console.log(`   🚀 Calling AI API with retry...`);

            let imageUrl = null;
            let mode = null;
            const maxRetries = 20;

            // retry sampe 20x
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    console.log(`   🔄 Attempt ${attempt}/${maxRetries}...`);

                    // generate gambar pake API
                    const response = await axios.get(
                        `https://wudysoft.xyz/api/ai/nano-banana/v12?prompt=${encodeURIComponent(input)}`,
                        { timeout: 30000 }
                    );

                    // cek kalo ada error di response
                    if (response.data.error) {
                        console.log(`   ⚠️  API Error: ${response.data.error}`);
                        continue;
                    }

                    // kalo sukses
                    if (response.data && response.data.result) {
                        imageUrl = response.data.result;
                        mode = response.data.mode || 'text-to-image';
                        console.log(`   ✅ Success on attempt ${attempt}`);
                        break;
                    }

                } catch (error) {
                    console.log(`   ⚠️  Attempt ${attempt} failed: ${error.message}`);
                }

                // delay sebentar sebelum retry (500ms)
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // cek kalo semua attempt gagal
            if (!imageUrl) {
                console.log(`   ❌ All ${maxRetries} attempts failed`);
                await sock.sendMessage(from, { 
                    text: `❌ Gagal generate gambar setelah ${maxRetries}x percobaan...\nAPI lagi bermasalah, coba lagi nanti ya` 
                }, { quoted: message });
                return false;
            }

            console.log(`   ✅ Image generated (${mode})`);

            // kirim hasil
            await sock.sendMessage(from, {
                image: { url: imageUrl },
                caption: `✨ Generated!\n\n📝 Prompt: ${input}\n🤖 Mode: ${mode}`
            }, { quoted: message });

            console.log(`   📤 Generated image sent to ${sender}`);
            return true;

        } catch (error) {
            console.error(`   ❌ Imagine plugin error:`, error.message);
            await sock.sendMessage(from, { text: 'error nih... coba lagi nanti' });
            return false;
        }
    }
};