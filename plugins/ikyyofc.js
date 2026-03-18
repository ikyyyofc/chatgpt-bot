import config from "../config.js";

export default {
    name: "owner_contact",
    description: "Mengirim kontak owner",
    execute: async ({ sock, from, message }) => {
        const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Owner\nORG:Owner\nTEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\nEND:VCARD`;

        await sock.sendMessage(
            from,
            {
                contacts: {
                    displayName: "Owner",
                    contacts: [{ vcard }]
                }
            },
            { quoted: message }
        );
    }
};