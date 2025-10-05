// plugins/editfoto.js
import axios from 'axios';
import uploadImage from "../lib/uploadImage.js";

export default {
    description: 'Edit foto serba bisa pake AI',
    
    async execute({ sock, from, input, message, sender, fileBuffer }) {
        try {
            if (!input) {
                await sock.sendMessage(from, { text: 'kasih prompt nya dong! contoh: tambahkan topi' });
                return false;
            }

            if (!fileBuffer) {
                await sock.sendMessage(from, { text: 'kirim atau quote foto yang mau di-edit dong!' });
                return false;
            }

            console.log(`   🎨 Editing image with prompt: ${input}`);
            const upl = await uploadImage(fileBuffer);
            console.log(`   🚀 Processing with AI...`);

            const result = (await axios.get(`https://wudysoft.xyz/api/ai/nano-banana/v17?prompt=${input}&imageUrl=${upl}`)).data

            if (!result.result.length || result.status !== "succeeded") {
              console.error(result)
              return false
            }

            const editedImageUrl = result.result[0];

            console.log(`   ✅ Image edited successfully`);

            await sock.sendMessage(from, {
                image: { url: editedImageUrl },
                caption: `✨ Done!\n\n📝 Prompt: ${input}`
            }, { quoted: message });

            console.log(`   📤 Edited image sent to ${sender}`);
            return true;

        } catch (error) {
            console.error(`   ❌ EditFoto plugin error:`, error.message);
            return false;
        }
    }
};