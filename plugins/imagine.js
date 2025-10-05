// plugins/imagine.js
import axios from 'axios';

export default {
    description: 'Generate gambar dari text pake AI',
    
    async execute({ sock, from, input, message, sender }) {
        try {
            if (!input) {
                await sock.sendMessage(from, { text: 'kasih prompt nya dong! contoh: cat in space' });
                return false;
            }

            console.log(`   🎨 Generating image with prompt: ${input}`);
            
            let result = (await axios.get(`https://wudysoft.xyz/api/ai/nano-banana/v17?prompt=${input}`)).data
            
            if (!result.result.length || result.status !== "succeeded") {
              console.error("Error API: ", result);
              return false
            }
            
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