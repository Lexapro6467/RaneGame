const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;


/* =========================
   TELEGRAM AUTH
========================= */

function validateTelegramInitData(initData) {
    if (!initData || !BOT_TOKEN) {
        return null;
    }

    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");
    const authDate = params.get("auth_date");

    if (!receivedHash || !authDate) {
        return null;
    }

    // Защита от слишком старых данных — 24 часа
    const now = Math.floor(Date.now() / 1000);

    if (now - Number(authDate) > 86400) {
        return null;
    }

    const dataCheckString = [...params.entries()]
        .filter(([key]) => key !== "hash")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

    const secretKey = crypto
        .createHmac("sha256", "WebAppData")
        .update(BOT_TOKEN)
        .digest();

    const calculatedHash = crypto
        .createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

    if (calculatedHash !== receivedHash) {
        return null;
    }

    const userData = params.get("user");

    if (!userData) {
        return null;
    }

    try {
        return JSON.parse(userData);
    } catch {
        return null;
    }
}


/* =========================
   SUPABASE
========================= */

async function getPlayer(telegramId) {

    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${telegramId}&select=*`,
        {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`
            }
        }
    );

    if (!response.ok) {
        throw new Error("Ошибка получения игрока");
    }

    const players = await response.json();

    return players.length > 0 ? players[0] : null;
}


async function createPlayer(user) {

    const response = await fetch(
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

    if (!response.ok) {
        throw new Error("Ошибка создания игрока");
    }

    const players = await response.json();

    return players[0];
}


/* =========================
   MAIN
========================= */

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});


/* =========================
   STATUS
========================= */

app.get("/api/status", (req, res) => {

    res.json({
        ok: true,
        message: "RaneGame server работает!"
    });

});


/* =========================
   LOAD PLAYER
========================= */

app.post("/api/player", async (req, res) => {

    try {

        const user = validateTelegramInitData(
            req.body.initData
        );

        if (!user) {

            return res.status(401).json({
                ok: false,
                error: "Telegram авторизация недействительна"
            });

        }

        let player = await getPlayer(user.id);

        if (!player) {
            player = await createPlayer(user);
        }

        res.json({
            ok: true,
            player
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });

    }

});


/* =========================
   COLLECT BONUS
========================= */

app.post("/api/collect", async (req, res) => {

    try {

        const user = validateTelegramInitData(
            req.body.initData
        );

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Telegram авторизация недействительна"
            });
        }

        const player = await getPlayer(user.id);

        if (!player) {
            return res.status(404).json({
                ok: false,
                error: "Игрок не найден"
            });
        }

        const newBalance =
            Number(player.balance) + 446;

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${user.id}`,
            {
                method: "PATCH",
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer: "return=representation"
                },
                body: JSON.stringify({
                    balance: newBalance
                })
            }
        );

        if (!response.ok) {
            throw new Error("Ошибка сохранения бонуса");
        }

        const updated = await response.json();

        res.json({
            ok: true,
            player: updated[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });

    }

});


/* =========================
   BUY
========================= */

app.post("/api/buy", async (req, res) => {

    try {

        const user = validateTelegramInitData(
            req.body.initData
        );

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Telegram авторизация недействительна"
            });
        }

        const price = Number(req.body.price);

        if (!Number.isInteger(price) || price <= 0) {

            return res.status(400).json({
                ok: false,
                error: "Неверная цена"
            });

        }

        const player = await getPlayer(user.id);

        if (!player) {

            return res.status(404).json({
                ok: false,
                error: "Игрок не найден"
            });

        }

        if (Number(player.balance) < price) {

            return res.status(400).json({
                ok: false,
                error: "Недостаточно ⭐"
            });

        }

        const newBalance =
            Number(player.balance) - price;

        const newIncome =
            Number(player.income) + 1;

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${user.id}`,
            {
                method: "PATCH",
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer: "return=representation"
                },
                body: JSON.stringify({
                    balance: newBalance,
                    income: newIncome
                })
            }
        );

        if (!response.ok) {
            throw new Error("Ошибка сохранения покупки");
        }

        const updated = await response.json();

        res.json({
            ok: true,
            player: updated[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });

    }

});


/* =========================
   FALLBACK
========================= */

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});


app.listen(PORT, () => {

    console.log(
        `RaneGame запущен на порту ${PORT}`
    );

});
