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


/* =====================================================
   TELEGRAM WEB APP AUTH
===================================================== */

function validateTelegramInitData(initData) {

    if (!initData) {
        return {
            ok: false,
            error: "initData отсутствует"
        };
    }

    if (!BOT_TOKEN) {
        return {
            ok: false,
            error: "BOT_TOKEN отсутствует в Render"
        };
    }

    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");
    const authDate = params.get("auth_date");

    if (!receivedHash) {
        return {
            ok: false,
            error: "hash отсутствует"
        };
    }

    if (!authDate) {
        return {
            ok: false,
            error: "auth_date отсутствует"
        };
    }

    const dataCheckString = [...params.entries()]
        .filter(([key]) => key !== "hash")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");


    /*
       Telegram:
       secret_key = HMAC_SHA256(bot_token, "WebAppData")
    */

    const secretKey = crypto
        .createHmac(
            "sha256",
            "WebAppData"
        )
        .update(BOT_TOKEN)
        .digest();


    const calculatedHash = crypto
        .createHmac(
            "sha256",
            secretKey
        )
        .update(dataCheckString)
        .digest("hex");


    /*
       Безопасное сравнение
    */

    const receivedBuffer =
        Buffer.from(receivedHash, "hex");

    const calculatedBuffer =
        Buffer.from(calculatedHash, "hex");


    if (
        receivedBuffer.length !==
        calculatedBuffer.length
    ) {
        return {
            ok: false,
            error:
                "HASH не совпал — проверь BOT_TOKEN в Render"
        };
    }


    if (
        !crypto.timingSafeEqual(
            receivedBuffer,
            calculatedBuffer
        )
    ) {
        return {
            ok: false,
            error:
                "HASH не совпал — проверь BOT_TOKEN в Render"
        };
    }


    /*
       Получаем пользователя
    */

    const userData =
        params.get("user");

    if (!userData) {
        return {
            ok: false,
            error: "Данные пользователя отсутствуют"
        };
    }


    let user;

    try {
        user = JSON.parse(userData);
    } catch {
        return {
            ok: false,
            error:
                "Не удалось прочитать данные Telegram"
        };
    }


    if (!user.id) {
        return {
            ok: false,
            error:
                "Telegram ID отсутствует"
        };
    }


    return {
        ok: true,
        user
    };
}


/* =====================================================
   SUPABASE
===================================================== */

async function getPlayer(telegramId) {

    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${telegramId}&select=*`,
        {
            headers: {
                apikey: SUPABASE_KEY,
                Authorization:
                    `Bearer ${SUPABASE_KEY}`
            }
        }
    );


    if (!response.ok) {

        console.error(
            await response.text()
        );

        throw new Error(
            "Ошибка получения игрока"
        );
    }


    const players =
        await response.json();


    if (!players.length) {
        return null;
    }


    return players[0];
}


/* =====================================================
   СОЗДАНИЕ ИГРОКА
===================================================== */

async function createPlayer(user) {

    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/players`,
        {
            method: "POST",

            headers: {
                apikey: SUPABASE_KEY,

                Authorization:
                    `Bearer ${SUPABASE_KEY}`,

                "Content-Type":
                    "application/json",

                Prefer:
                    "return=representation"
            },

            body: JSON.stringify({
                telegram_id: user.id,

                username:
                    user.username || null,

                first_name:
                    user.first_name || "Игрок"
            })
        }
    );


    if (!response.ok) {

        console.error(
            await response.text()
        );

        throw new Error(
            "Ошибка создания игрока"
        );
    }


    const players =
        await response.json();


    return players[0];
}


/* =====================================================
   ОБНОВЛЕНИЕ ИГРОКА
===================================================== */

async function updatePlayer(
    telegramId,
    data
) {

    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${telegramId}`,
        {
            method: "PATCH",

            headers: {
                apikey: SUPABASE_KEY,

                Authorization:
                    `Bearer ${SUPABASE_KEY}`,

                "Content-Type":
                    "application/json",

                Prefer:
                    "return=representation"
            },

            body:
                JSON.stringify(data)
        }
    );


    if (!response.ok) {

        console.error(
            await response.text()
        );

        throw new Error(
            "Ошибка обновления игрока"
        );
    }


    const players =
        await response.json();


    return players[0];
}


/* =====================================================
   ГЛАВНАЯ
===================================================== */

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );

});


/* =====================================================
   STATUS
===================================================== */

app.get("/api/status", (req, res) => {

    res.json({
        ok: true,
        message:
            "RaneGame server работает!"
    });

});


/* =====================================================
   PLAYER
===================================================== */

app.post(
    "/api/player",
    async (req, res) => {

        try {

            const auth =
                validateTelegramInitData(
                    req.body.initData
                );


            if (!auth.ok) {

                return res.status(401).json({
                    ok: false,
                    error: auth.error
                });

            }


            const user =
                auth.user;


            let player =
                await getPlayer(
                    user.id
                );


            if (!player) {

                player =
                    await createPlayer(
                        user
                    );

            }


            res.json({
                ok: true,
                player
            });


        } catch (error) {

            console.error(
                "PLAYER ERROR:",
                error
            );


            res.status(500).json({
                ok: false,
                error:
                    "Ошибка сервера"
            });

        }

    }
);


/* =====================================================
   BONUS
===================================================== */

app.post(
    "/api/collect",
    async (req, res) => {

        try {

            const auth =
                validateTelegramInitData(
                    req.body.initData
                );


            if (!auth.ok) {

                return res.status(401).json({
                    ok: false,
                    error: auth.error
                });

            }


            const user =
                auth.user;


            const player =
                await getPlayer(
                    user.id
                );


            if (!player) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "Игрок не найден"
                });

            }


            const balance =
                Number(player.balance);


            const updated =
                await updatePlayer(
                    user.id,
                    {
                        balance:
                            balance + 446
                    }
                );


            res.json({
                ok: true,
                player: updated
            });


        } catch (error) {

            console.error(
                "COLLECT ERROR:",
                error
            );


            res.status(500).json({
                ok: false,
                error:
                    "Ошибка бонуса"
            });

        }

    }
);


/* =====================================================
   BUY
===================================================== */

app.post(
    "/api/buy",
    async (req, res) => {

        try {

            const auth =
                validateTelegramInitData(
                    req.body.initData
                );


            if (!auth.ok) {

                return res.status(401).json({
                    ok: false,
                    error: auth.error
                });

            }


            const user =
                auth.user;


            const price =
                Number(req.body.price);


            if (
                !Number.isInteger(price) ||
                price <= 0
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Неверная цена"
                });

            }


            const player =
                await getPlayer(
                    user.id
                );


            if (!player) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "Игрок не найден"
                });

            }


            const balance =
                Number(player.balance);


            if (balance < price) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Недостаточно ⭐"
                });

            }


            const income =
                Number(player.income);


            const updated =
                await updatePlayer(
                    user.id,
                    {
                        balance:
                            balance - price,

                        income:
                            income + 1
                    }
                );


            res.json({
                ok: true,
                player: updated
            });


        } catch (error) {

            console.error(
                "BUY ERROR:",
                error
            );


            res.status(500).json({
                ok: false,
                error:
                    "Ошибка покупки"
            });

        }

    }
);


/* =====================================================
   FALLBACK
===================================================== */

app.get("*", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );

});


/* =====================================================
   START
===================================================== */

app.listen(
    PORT,
    () => {

        console.log(
            `RaneGame запущен на порту ${PORT}`
        );

    }
);
