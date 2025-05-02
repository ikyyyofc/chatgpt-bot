const axios = require("axios");

// Fungsi untuk memulai sesi dan mendapatkan sessionId dan restNonce
async function startSession() {
    try {
        const response = await axios.post(
            "https://www.pinoygpt.com/wp-json/mwai/v1/start_session",
            {},
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        // Mengembalikan sessionId dan restNonce
        return {
            sessionId: response.data.sessionId,
            restNonce: response.data.restNonce
        };
    } catch (error) {
        throw new Error("Error starting session: " + error.message);
    }
}

// Fungsi untuk mengirimkan pesan chat dengan data chat yang sudah dipersiapkan
async function submitChat(sessionId, restNonce, array_hs, newMsg) {
    const chatData = {
        botId: `chatbot-4yaap9`,
        customId: null,
        session: sessionId, // Gunakan sessionId yang didapat dari startSession
        chatId: `oy0pgy4e5pc`,
        contextId: 12,
        messages: array_hs,
        newMessage: newMsg,
        newFileId: null,
        stream: false
    };

    try {
        const response = await axios.post(
            "https://www.pinoygpt.com/wp-json/mwai-ui/v1/chats/submit",
            chatData,
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-WP-Nonce": restNonce, // Gunakan restNonce dari startSession
                    Accept: "text/event-stream",
                    "User-Agent":
                        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
                }
                // Gunakan stream untuk menerima data event
            }
        );

        return response.data; // Mengembalikan data hasil pengiriman chat
    } catch (error) {
        throw new Error("Error submitting chat: " + error.message);
    }
}

// Fungsi utama untuk menggabungkan kedua proses: start session dan submit chat
const startAndSubmitChat = async (array_hs, newMsg) => {
    try {
        // Langkah 1: Memulai sesi dan mendapatkan sessionId dan restNonce
        const { sessionId, restNonce } = await startSession();
        let ms_hs = array_hs;
        let arr = ms_hs.map(item => ({
            ...item, // Pertahankan properti lainnya
            role: "user" // Ganti role jadi 'user'
        }));

        // Langkah 2: Mengirimkan chat menggunakan sessionId dan restNonce yang diperoleh
        const chatResponse = await submitChat(
            sessionId,
            restNonce,
            arr,
            newMsg
        );

        // Mengembalikan hasil pengiriman chat
        return chatResponse;
    } catch (error) {
        throw new Error(
            "Error during session and chat submission: " + error.message
        );
    }
};

async function gemini(data_msg, newMsg) {
    try {
        // Proses array_hs dari data_msg
        let array_hs = data_msg;
        
        // Langkah 1: Memulai sesi dan mendapatkan sessionId dan restNonce
        const { sessionId, restNonce } = await startSession();
        
        let arr = array_hs.map(item => ({
            ...item,
            role: "user"
        }));

        // Langkah 2: Mengirimkan chat
        const chatResponse = await submitChat(
            sessionId,
            restNonce,
            arr,
            newMsg
        );

        // Pastikan mengembalikan objek dengan properti reply
        return { 
            reply: chatResponse.response || chatResponse 
        };
    } catch (error) {
        throw new Error(
            "Error during chat process: " + error.message
        );
    }
}

// Fungsi startSession dan submitChat tetap sama seperti sebelumnya

module.exports = gemini;