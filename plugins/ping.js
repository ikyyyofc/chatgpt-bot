export default {
    name: "ping",
    description: "Gunakan ini untuk merespon ketika pengguna mengecek status bot, mengetes apakah bot sedang aktif (misalnya mengetik 'ping', 'tes', 'halo bot'), atau mengecek kecepatan respon.",
    parameters: {
        type: "OBJECT",
        properties: {
            balasan: {
                type: "STRING",
                description: "Pesan balasan ramah dari karakter bot (Risa) yang menyatakan bahwa bot sedang aktif, online, dan siap membantu."
            }
        },
        required: ["balasan"]
    },
    execute: async ({ sock, from, args, message }) => {
        // AI akan mengisi args.balasan dengan kata-kata yang sesuai dengan personanya
        const balasanAI = args?.balasan || "Pong! Risa di sini, sistem aktif dan merespon dengan cepat! 🏓";
        
        await sock.sendMessage(from, { text: balasanAI }, { quoted: message });
    }
};
