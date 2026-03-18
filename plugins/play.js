import axios from "axios";

export default {
    name: "play",
    description: "Mencari dan memutar lagu dari YouTube (Audio).",
    execute: async ({ sock, from, input, message }) => {
        try {
            if (!input) {
                return await sock.sendMessage(from, { text: "❌ Mau putar lagu apa? Kasih judulnya dong." }, { quoted: message });
            }

            const msg = await sock.sendMessage(from, { text: "🔍 Bentar, gw cariin dulu lagunya..." }, { quoted: message });

            const searchRes = await axios.get(`https://wudysoft.xyz/api/search/youtube/v6?query=${encodeURIComponent(input)}`);
            const items = searchRes.data?.data?.items;
            
            if (!items || items.length === 0) {
                return await sock.sendMessage(from, { text: "❌ Gagal nemuin lagunya di YouTube.", edit: msg.key });
            }

            const vid = items[0];
            await sock.sendMessage(from, { text: `⏳ Ketemu nih: *${vid.title}*\nLagi proses convert ke mp3...`, edit: msg.key });

            const dlRes = await axios.get(`https://api.ryzumi.net/api/downloader/ytmp3?url=https://youtu.be/${vid.id}`);
            const audioUrl = dlRes.data?.url;

            if (!audioUrl) {
                return await sock.sendMessage(from, { text: "❌ Gagal dapet link download mp3-nya.", edit: msg.key });
            }

            await sock.sendMessage(from, {
                audio: { url: audioUrl },
                mimetype: "audio/mpeg",
                fileName: `${vid.title}.mp3`
            }, { quoted: message });

            await sock.sendMessage(from, { delete: msg.key });

        } catch (err) {
            await sock.sendMessage(from, { text: `❌ Waduh error cuy: ${err.message}` }, { quoted: message });
        }
    }
};