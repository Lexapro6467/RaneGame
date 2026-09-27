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


/* =========================================================
   TELEGRAM AUTH
========================================================= */

function validateTelegramInitData(initData) {

    console.log("=================================");
    console.log("TELEGRAM AUTH");
    console.log("=================================");

    if (!initData) {

        console.log("❌ initData отсутствует");

        return {
            ok: false,
            error: "initData отсутствует"
        };

    }


    if (!BOT_TOKEN) {

        console.log("❌ BOT_TOKEN отсутствует");

        return {
            ok: false,
            error: "BOT_TOKEN не найден в Render"
        };

    }


    console.log(
        "initData получен. Длина:",
        initData.length
    );


    const params =
        new URLSearchParams(initData);


    const receivedHash =
        params.get("hash");

    const authDate =
        params.get("auth_date");

    const userData =
        params.get("user");


    if (!receivedHash) {

        console.log("❌ hash отсутствует");

        return {
            ok: false,
            error: "hash отсутствует"
        };

    }


    if (!authDate) {

        console.log("❌ auth_date отсутствует");

        return {
            ok: false,
            error: "auth_date отсутствует"
        };

    }


    if (!userData) {

        console.log("❌ user отсутствует");

        return {
            ok: false,
            error: "user отсутствует"
        };

    }


    /*
       Проверяем время.
       Разрешаем данные не старше 24 часов.
    */

    const now =
        Math.floor(Date.now() / 1000);

    const authTime =
        Number(authDate);

    const age =
        now - authTime;


    console.log(
        "Возраст initData:",
        age,
        "сек."
    );


    if (
        !Number.isFinite(authTime) ||
        age < -300 ||
        age > 86400
    ) {

        console.log(
            "❌ initData устарел"
        );

        return {
            ok: false,
            error: "initData устарел"
        };

    }


    /*
       Формируем строку проверки Telegram.
    */

    const dataCheckString =
        [...params.entries()]
            .filter(
                ([key]) =>
                    key !== "hash"
            )
            .sort(
                ([a], [b]) =>
                    a.localeCompare(b)
            )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");


    /*
       Создаём секретный ключ.
    */

    const secretKey =
        crypto
            .createHmac(
                "sha256",
                "WebAppData"
            )
            .update(BOT_TOKEN)
            .digest();


    /*
       Создаём правильный hash.
    */

    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(dataCheckString)
            .digest("hex");


    /*
       Сравниваем hash.
    */

    if (
        calculatedHash !==
        receivedHash
    ) {

        console.log(
            "❌ HASH НЕ СОВПАЛ"
        );

        console.log(
            "Проверь BOT_TOKEN в Render."
        );

        return {
            ok: false,
            error:
                "HASH не совпал — проверь BOT_TOKEN в Render"
        };

    }


    /*
       Получаем Telegram пользователя.
    */

    let user;

    try {

        user =
            JSON.parse(userData);

    } catch (error) {

        console.log(
            "❌ Не удалось прочитать user"
        );

        return {
            ok: false,
            error:
                "Ошибка данных пользователя Telegram"
        };

    }


    if (!user.id) {

        console.log(
            "❌ Telegram ID отсутствует"
        );

        return {
            ok: false,
            error:
                "Telegram ID отсутствует"
        };

    }


    console.log(
        "✅ Telegram ID:",
        user.id
    );

    console.log(
        "✅ Авторизация успешна"
    );


    return {
        ok: true,
        user: user
    };

}


/* =========================================================
   SUPABASE — ПОЛУЧИТЬ ИГРОКА
========================================================= */

async function getPlayer(telegramId) {

    const response =
        await fetch(
            `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${telegramId}&select=*`,
            {
                method: "GET",

                headers: {
                    apikey:
                        SUPABASE_KEY,

                    Authorization:
                        `Bearer ${SUPABASE_KEY}`
                }
            }
        );


    if (!response.ok) {

        const text =
            await response.text();

        console.error(
            "Supabase GET error:",
            text
        );

        throw new Error(
            "Ошибка получения игрока"
        );

    }


    const players =
        await response.json();


    if (
        !Array.isArray(players) ||
        players.length === 0
    ) {

        return null;

    }


    return players[0];

}


/* =========================================================
   SUPABASE — СОЗДАТЬ ИГРОКА
========================================================= */

async function createPlayer(user) {

    const response =
        await fetch(
            `${SUPABASE_URL}/rest/v1/players`,
            {
                method: "POST",

                headers: {
                    apikey:
                        SUPABASE_KEY,

                    Authorization:
                        `Bearer ${SUPABASE_KEY}`,

                    "Content-Type":
                        "application/json",

                    Prefer:
                        "return=representation"
                },

                body:
                    JSON.stringify({

                        telegram_id:
                            user.id,

                        username:
                            user.username ||
                            null,

                        first_name:
                            user.first_name ||
                            "Игрок"

                    })
            }
        );


    if (!response.ok) {

        const text =
            await response.text();

        console.error(
            "Supabase CREATE error:",
            text
        );

        throw new Error(
            "Ошибка создания игрока"
        );

    }


    const players =
        await response.json();


    return players[0];

}


/* =========================================================
   SUPABASE — ОБНОВИТЬ ИГРОКА
========================================================= */

async function updatePlayer(
    telegramId,
    data
) {

    const response =
        await fetch(
            `${SUPABASE_URL}/rest/v1/players?telegram_id=eq.${telegramId}`,
            {
                method: "PATCH",

                headers: {
                    apikey:
                        SUPABASE_KEY,

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

        const text =
            await response.text();

        console.error(
            "Supabase UPDATE error:",
            text
        );

        throw new Error(
            "Ошибка сохранения игрока"
        );

    }


    const players =
        await response.json();


    return players[0];

}


/* =========================================================
   ГЛАВНАЯ
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );

    }
);


/* =========================================================
   STATUS
========================================================= */

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            ok: true,

            message:
                "RaneGame server работает!"

        });

    }
);


/* =========================================================
   ПОЛУЧИТЬ ИГРОКА
========================================================= */

app.post(
    "/api/player",
    async (req, res) => {

        try {

            const auth =
                validateTelegramInitData(
                    req.body.initData
                );


            if (!auth.ok) {

                return res
                    .status(401)
                    .json({

                        ok: false,

                        error:
                            auth.error

                    });

            }


            const user =
                auth.user;


            let player =
                await getPlayer(
                    user.id
                );


            /*
               Если игрока нет —
               создаём.
            */

            if (!player) {

                player =
                    await createPlayer(
                        user
                    );

            }


            res.json({

                ok: true,

                player: player

            });


        } catch (error) {

            console.error(
                "PLAYER ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "Ошибка сервера"

                });

        }

    }
);


/* =========================================================
   ПОЛУЧИТЬ БОНУС
========================================================= */

app.post(
    "/api/collect",
    async (req, res) => {

        try {

            const auth =
                validateTelegramInitData(
                    req.body.initData
                );


            if (!auth.ok) {

                return res
                    .status(401)
                    .json({

                        ok: false,

                        error:
                            auth.error

                    });

            }


            const user =
                auth.user;


            const player =
                await getPlayer(
                    user.id
                );


            if (!player) {

                return res
                    .status(404)
                    .json({

                        ok: false,

                        error:
                            "Игрок не найден"

                    });

            }


            const currentBalance =
                Number(
                    player.balance
                );


            const newBalance =
                currentBalance + 446;


            const updated =
                await updatePlayer(
                    user.id,
                    {
                        balance:
                            newBalance
                    }
                );


            res.json({

                ok: true,

                player:
                    updated

            });


        } catch (error) {

            console.error(
                "COLLECT ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "Ошибка сохранения бонуса"

                });

        }

    }
);


/* =========================================================
   ПОКУПКА
========================================================= */

app.post(
    "/api/buy",
    async (req, res) => {

        try {

            const auth =
                validateTelegramInitData(
                    req.body.initData
                );


            if (!auth.ok) {

                return res
                    .status(401)
                    .json({

                        ok: false,

                        error:
                            auth.error

                    });

            }


            const user =
                auth.user;


            const price =
                Number(
                    req.body.price
                );


            /*
               Разрешаем только
               целые положительные цены.
            */

            if (
                !Number.isInteger(price) ||
                price <= 0
            ) {

                return res
                    .status(400)
                    .json({

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

                return res
                    .status(404)
                    .json({

                        ok: false,

                        error:
                            "Игрок не найден"

                    });

            }


            const currentBalance =
                Number(
                    player.balance
                );


            /*
               Проверяем баланс.
            */

            if (
                currentBalance <
                price
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Недостаточно ⭐"

                    });

            }


            /*
               Снимаем деньги.
            */

            const newBalance =
                currentBalance -
                price;


            /*
               Пока каждая покупка
               даёт +1 к доходу.
            */

            const newIncome =
                Number(
                    player.income
                ) + 1;


            const updated =
                await updatePlayer(
                    user.id,
                    {

                        balance:
                            newBalance,

                        income:
                            newIncome

                    }
                );


            res.json({

                ok: true,

                player:
                    updated

            });


        } catch (error) {

            console.error(
                "BUY ERROR:",
                error
            );


            res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "Ошибка покупки"

                });

        }

    }
);


/* =========================================================
   FALLBACK
========================================================= */

app.get(
    "*",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );

    }
);


/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `RaneGame запущен на порту ${PORT}`
        );

    }
);
