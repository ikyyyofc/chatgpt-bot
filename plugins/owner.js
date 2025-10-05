export default {
    description: "kontak owner kalo ada bug atau error",
    async execute({ sock, from, input, message, sender, fileBuffer }) {
        try {
            const vcard =
                "BEGIN:VCARD\n" + // metadata of the contact card
                "VERSION:3.0\n" +
                "FN:IkyyOFC\n" + // full name
                "ORG:Owner Ikyy;\n" + // the organization of the contact
                "TEL;type=CELL;type=VOICE;waid=6287866255637:+62 878-6625-5637\n" + // WhatsApp ID + phone number
                "END:VCARD";

            return sock.sendMessage(from, {
                contacts: {
                    displayName: "Jeff",
                    contacts: [{ vcard }]
                }
            });
        } catch (e) {}
    }
};
