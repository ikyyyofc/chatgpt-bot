import yts from "yt-search";
import { Innertube } from "youtubei.js";
import fs from "fs";
import path from "path";

export default {
    description: "kirim video dari YouTube",

    async execute({ sock, from, input, message, sender }) {
        try {
            // search video pake yt-search
            let anu = await yts(input);
            let f = anu.all.filter(v => !v.url.includes("@"));

            if (!f.length) {
                console.error("Video Not Found...");
                return false;
            }

            const video = f[0];
            const url = video.url;
            const title = video.title;
            const ago = video.ago;
            const author = video.author.name;

            // init innertube
            const innertube = await Innertube.create();
            
            // ambil info video
            const info = await innertube.getInfo(video.videoId);

            // ambil format video 360p
            const format = info.chooseFormat({ 
                quality: "360p",
                type: "video+audio"
            });

            // bikin folder temp kalo belom ada
            const tempDir = path.join(process.cwd(), "temp");
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            const fileName = `${Date.now()}.mp4`;
            const filePath = path.join(tempDir, fileName);

            // download video
            const stream = await info.download({
                type: "video+audio",
                quality: "360p",
                format: "mp4"
            });

            const writer = fs.createWriteStream(filePath);
            
            for await (const chunk of stream) {
                writer.write(chunk);
            }

            writer.end();

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

            // hapus file
            fs.unlinkSync(filePath);

            return true;
        } catch (error) {
            console.error(`   ❌ Video Plugin error:`, error.message);
            return false;
        }
    }
};