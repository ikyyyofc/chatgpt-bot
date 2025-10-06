import yts from "yt-search";
import axios from "axios";
import fs from "fs";
import path from "path";

export default {
    description: "kirim video dari YouTube",

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
                `https://api.nekolabs.my.id/downloader/youtube/v1?url=${url}&format=360`
            );

            if (!res.data.status) {
                console.error("Error API: ", res.data);
                return false;
            }

            const downloadUrl = res.data.result.downloadUrl;

            // bikin folder temp kalo belom ada
            const tempDir = path.join(process.cwd(), "temp");
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            // path file sementara
            const fileName = `${Date.now()}.mp4`;
            const filePath = path.join(tempDir, fileName);

            // download ke lokal
            const writer = fs.createWriteStream(filePath);
            const response = await axios({
                url: downloadUrl,
                method: "GET",
                responseType: "stream"
            });

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

            // kirim dari lokal
            await sock.sendMessage(
                from,
                {
                    video: fs.readFileSync(filePath),
                    caption: `${title}\n\n${author} || ${ago}`
                },
                { quoted: message }
            );

            // hapus file setelah terkirim
            fs.unlinkSync(filePath);

            return true;
        } catch (error) {
            console.error(`   ❌ Video Plugin error:`, error.message);
            return false;
        }
    }
};