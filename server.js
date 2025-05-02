const express = require("express");
const server = express();
//const secure = require("ssl-express-www");
const PORT = 7860;

function formatUptime(second) {
    // Konversi detik menjadi jam, menit, dan detik
    let hours = Math.floor(second / 3600);
    let minutes = Math.floor((second % 3600) / 60);
    let seconds = Math.floor(second % 60);

    // Tambahkan angka nol di depan jika kurang dari 10
    let pad = n => (n < 10 ? "0" + n : n);

    // Kembalikan string dengan format hh:mm:ss
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
}

server.use(express.json());
server.use(express.urlencoded({ extended: true }));
//server.use(secure);
server.all("/health", (req, res) => {
    res.json({
        status: true,
        uptime: formatUptime(process.uptime())
    });
});
server.all("/", (req, res) => {
    res.status(200).send(generateRandomString(500));
});

server.listen(PORT, () => console.log(`Server running with port ${PORT}!`));

function generateRandomString(length) {
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?";
    let randomString = "";

    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        randomString += characters.charAt(randomIndex);
    }

    return randomString;
}
