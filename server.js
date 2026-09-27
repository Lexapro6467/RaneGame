const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Получить игрока Telegram
async function getTelegramUser(initData) {
    if (!initData) return null;

    const params = new URLSearchParams(initData);
    const userData = params.get("user");

    if (!userData) return null;

    try {
        return JSON.parse(userData);
    } catch {
        return null;
    }
}

// Главная страница
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Проверка сервера
app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        message: "RaneGame server работает!"
    });
});

// Получение / создание игрока
app.post("/api/player", async (req, res) => {
    try {
        const user = await getTelegramUser(req.body.initData);

        if (!user) {
            return res.status(400).json({
                ok: false,
                error: "Telegram пользователь не найден"
            });
        }

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${user.id}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );

        const players = await response.json();

        if (players.length > 0) {
            return res.json({
                ok: true,
                player: players[0]
            });
        }

        const createResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/players`,
            {
                method: "POST",
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer: "return=representation"
                },
                body: JSON.stringify({
                    telegram_id: user.id,
                    username: user.username || null,
                    first_name: user.first_name || "Игрок"
                })
            }
        );

        const newPlayer = await createResponse.json();

        res.json({
            ok: true,
            player: newPlayer[0]
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });
    }
});

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`RaneGame запущен на порту ${PORT}`);
});
