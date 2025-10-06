import axios from "axios";
export default {
    description: "download video tiktok dari url (url tiktok)",
    async execute({ sock, from, input, message, sender, fileBuffer }) {
        try {
            let res = (
                await axios.post("https://tikwm.com/api/", `url=${input}`)
            ).data;
            if (res.code !== 0) {
                console.error("Error API: ", res);
                return false;
            }
            await sock.sendMessage(
                from,
                {
                    video: {
                        url: res.data.play
                    },
                    caption: `${res.data.title}\n\n@${res.data.author.unique_id}`
                },
                { quoted: message }
            );
            return true;
        } catch (e) {
            console.error("Error Plugin: ", e);
            return false;
        }
    }
};
