const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Показываем игру
app.use(express.static(path.join(__dirname)));

// Проверка сервера
app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        message: "RaneGame server работает!"
    });
});

// Главная страница
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`RaneGame запущен на порту ${PORT}`);
});
