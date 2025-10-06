// plugins/play.js
import yts from "yt-search";
import axios from "axios";

export default {
    description: "dapetin video dari YouTube",

    async execute({ sock, from, input, message, sender }) {
        try {
            let anu = await yts(input);
            let f = anu.all.filter(v => !v.url.includes("@"));

            if (!f.length) {
                console.error("Video Not Found...");
                return false;
            }

            const video = f[0];
            const url = video.url;
            const thumbnail = video.thumbnail;
            const title = video.title;
            const ago = video.ago;
            const author = video.author.name;

            const res = await axios.get(
                `https://api.nekolabs.my.id/downloader/youtube/v1?url=${url}&format=480`
            );

            if (!res.data.status) {
                console.error("Error API: ", res.data);
                return false;
            }

            const downloadUrl = res.data.result.downloadUrl;

            await sock.sendMessage(
                from,
                {
                    video: {
                        url: downloadUrl
                    },
                    caption: `${title}\n\n${author} || ${ago}`
                },
                { quoted: message }
            );
            return true;
        } catch (error) {
            console.error(`   ❌ Play plugin error:`, error.message);
            return false;
        }
    }
};
