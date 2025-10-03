// plugins/play.js
const yts = require('yt-search');
const axios = require('axios');

module.exports = {
    description: 'Putar lagu dari YouTube',
    
    async execute({ sock, from, input, message, sender }) {
        try {
            if (!input) {
                await sock.sendMessage(from, { text: 'kasih judul lagu dong...' });
                return false;
            }

            console.log(`   🎵 Searching: ${input}`);
            
            // cari di youtube
            let anu = await yts(input);
            let f = anu.all.filter(v => !v.url.includes("@"));
            
            if (!f.length) {
                await sock.sendMessage(from, { text: 'ga nemu lagu nya nih...' });
                return false;
            }

            const video = f[0];
            const url = video.url;
            const thumbnail = video.thumbnail;
            const title = video.title;
            const ago = video.ago;
            const author = video.author.name;

            console.log(`   ✅ Found: ${title}`);

            // kirim info
            await sock.sendMessage(from, { 
                text: `🎵 *${title}*\n👤 ${author}\n📅 ${ago}\n\n⬇️ Downloading...` 
            }, { quoted: message });

            // download pake API
            console.log(`   ⬇️  Downloading from API...`);
            const res = await axios.get(
                `https://api.nekolabs.my.id/downloader/youtube/v1?url=${url}&format=mp3`
            );

            if (!res.data.status) {
                await sock.sendMessage(from, { text: 'gagal download nih...' });
                return false;
            }

            const downloadUrl = res.data.result.downloadUrl;

            console.log(`   📤 Sending audio...`);

            // kirim audio
            await sock.sendMessage(from, {
                audio: { url: downloadUrl },
                mimetype: 'audio/mpeg',
                fileName: `${title}.mp3`,
                contextInfo: {
                    externalAdReply: {
                        title: title,
                        body: `${author} | ${ago}`,
                        thumbnailUrl: thumbnail,
                        mediaType: 1,
                        showAdAttribution: false,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: message });

            console.log(`   ✅ Audio sent to ${sender}`);
            return true;

        } catch (error) {
            console.error(`   ❌ Play plugin error:`, error.message);
            await sock.sendMessage(from, { text: 'error sih... coba lagi nanti' });
            return false;
        }
    }
};