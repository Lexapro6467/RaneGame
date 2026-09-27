const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Не заданы SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

if (!BOT_TOKEN) {
    console.error("❌ Не задан BOT_TOKEN");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
========================================================= */

async function getPlayer(telegramId) {
    const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

async function createPlayer(user) {
    const { data, error } = await supabase
        .from("players")
        .insert({
            telegram_id: user.id,
            username: user.username || null,
            first_name: user.first_name || "",
            balance: 3918,
            income: 201
        })
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function getOrCreatePlayer(user) {
    let player = await getPlayer(user.id);

    if (!player) {
        player = await createPlayer(user);
    }

    return player;
}

/* =========================================================
   ГЛАВНАЯ СТРАНИЦА
========================================================= */

app.get("/", (req, res) => {
    const indexPath = path.join(__dirname, "index.html");

    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    return res.status(200).send("RaneGame server работает.");
});

/* =========================================================
   API: ПОЛУЧЕНИЕ ИГРОКА
========================================================= */

app.post("/api/player", async (req, res) => {
    try {
        const user = req.body?.user;

        if (!user || !user.id) {
            return res.status(400).json({
                ok: false,
                error: "Не передан Telegram user"
            });
        }

        const player = await getOrCreatePlayer(user);

        return res.json({
            ok: true,
            player
        });

    } catch (error) {
        console.error("PLAYER ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });
    }
});

/* =========================================================
   API: ПОКУПКА
========================================================= */

app.post("/api/buy", async (req, res) => {
    try {
        const telegramId = Number(req.body?.telegram_id);
        const item = req.body?.item;

        if (!telegramId) {
            return res.status(400).json({
                ok: false,
                error: "Не указан telegram_id"
            });
        }

        const player = await getPlayer(telegramId);

        if (!player) {
            return res.status(404).json({
                ok: false,
                error: "Игрок не найден"
            });
        }

        /*
         Здесь оставлена простая покупка.
         Если твой index.html использует item.price,
         цена берётся из запроса.
        */

        const price = Number(item?.price || 0);

        if (price <= 0) {
            return res.status(400).json({
                ok: false,
                error: "Неверная цена"
            });
        }

        if (Number(player.balance) < price) {
            return res.status(400).json({
                ok: false,
                error: "Недостаточно ⭐"
            });
        }

        const newBalance = Number(player.balance) - price;

        const { data: updatedPlayer, error } = await supabase
            .from("players")
            .update({
                balance: newBalance
            })
            .eq("telegram_id", telegramId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return res.json({
            ok: true,
            player: updatedPlayer
        });

    } catch (error) {
        console.error("BUY ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Ошибка покупки"
        });
    }
});

/* =========================================================
   API: ЕЖЕНЕДЕЛЬНЫЙ БОНУС
========================================================= */

app.post("/api/collect", async (req, res) => {
    try {
        const telegramId = Number(req.body?.telegram_id);

        if (!telegramId) {
            return res.status(400).json({
                ok: false,
                error: "Не указан telegram_id"
            });
        }

        const player = await getPlayer(telegramId);

        if (!player) {
            return res.status(404).json({
                ok: false,
                error: "Игрок не найден"
            });
        }

        const now = new Date();

        if (player.bonus_claimed_at) {
            const lastClaim = new Date(player.bonus_claimed_at);
            const diff = now.getTime() - lastClaim.getTime();

            const sevenDays = 7 * 24 * 60 * 60 * 1000;

            if (diff < sevenDays) {
                const remaining = sevenDays - diff;

                return res.status(400).json({
                    ok: false,
                    error: "Бонус ещё недоступен",
                    remaining
                });
            }
        }

        const newBalance = Number(player.balance) + 1000;

        const { data: updatedPlayer, error } = await supabase
            .from("players")
            .update({
                balance: newBalance,
                bonus_claimed_at: now.toISOString()
            })
            .eq("telegram_id", telegramId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return res.json({
            ok: true,
            reward: 1000,
            player: updatedPlayer
        });

    } catch (error) {
        console.error("COLLECT ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Ошибка получения бонуса"
        });
    }
});

/* =========================================================
   API: РУЛЕТКА
========================================================= */

app.post("/api/roulette/spin", async (req, res) => {
    try {
        const telegramId = Number(req.body?.telegram_id);

        if (!telegramId) {
            return res.status(400).json({
                ok: false,
                error: "Не указан telegram_id"
            });
        }

        const player = await getPlayer(telegramId);

        if (!player) {
            return res.status(404).json({
                ok: false,
                error: "Игрок не найден"
            });
        }

        const spinPrice = 50;

        if (Number(player.balance) < spinPrice) {
            return res.status(400).json({
                ok: false,
                error: "Недостаточно ⭐"
            });
        }

        const rewards = [
            0,
            10,
            20,
            30,
            50,
            100,
            200
        ];

        const reward =
            rewards[Math.floor(Math.random() * rewards.length)];

        const newBalance =
            Number(player.balance) - spinPrice + reward;

        const { data: updatedPlayer, error } = await supabase
            .from("players")
            .update({
                balance: newBalance
            })
            .eq("telegram_id", telegramId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return res.json({
            ok: true,
            reward,
            player: updatedPlayer
        });

    } catch (error) {
        console.error("ROULETTE ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Ошибка рулетки"
        });
    }
});

/* =========================================================
   API: ПОЛУЧЕНИЕ НАГРАДЫ РУЛЕТКИ
========================================================= */

app.post("/api/roulette/claim", async (req, res) => {
    try {
        const telegramId = Number(req.body?.telegram_id);
        const reward = Number(req.body?.reward || 0);

        if (!telegramId) {
            return res.status(400).json({
                ok: false,
                error: "Не указан telegram_id"
            });
        }

        if (reward < 0 || reward > 10000) {
            return res.status(400).json({
                ok: false,
                error: "Неверная награда"
            });
        }

        const player = await getPlayer(telegramId);

        if (!player) {
            return res.status(404).json({
                ok: false,
                error: "Игрок не найден"
            });
        }

        const newBalance =
            Number(player.balance) + reward;

        const { data: updatedPlayer, error } = await supabase
            .from("players")
            .update({
                balance: newBalance
            })
            .eq("telegram_id", telegramId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return res.json({
            ok: true,
            reward,
            player: updatedPlayer
        });

    } catch (error) {
        console.error("ROULETTE CLAIM ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Ошибка получения награды"
        });
    }
});

/* =========================================================
   API: ПОДДЕРЖКА СТАРОГО SHOP
========================================================= */

app.get("/api/shop", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("gifts")
            .select("*")
            .eq("active", true);

        if (error) {
            throw error;
        }

        return res.json({
            ok: true,
            gifts: data || []
        });

    } catch (error) {
        console.error("SHOP ERROR:", error);

        return res.status(500).json({
            ok: false,
            error: "Ошибка магазина"
        });
    }
});

/* =========================================================
   TELEGRAM BOT
========================================================= */

async function telegramRequest(method, body = {}) {
    const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        }
    );

    return response.json();
}

let telegramOffset = 0;

async function processTelegramUpdates() {
    try {
        const result = await telegramRequest("getUpdates", {
            offset: telegramOffset,
            timeout: 20
        });

        if (!result.ok || !Array.isArray(result.result)) {
            return;
        }

        for (const update of result.result) {
            telegramOffset = update.update_id + 1;

            if (!update.message) {
                continue;
            }

            const message = update.message;
            const text = message.text || "";
            const user = message.from;

            if (!user) {
                continue;
            }

            /* ============================================
               /start
            ============================================ */

            if (text.startsWith("/start")) {
                try {
                    let player = await getPlayer(user.id);

                    /*
                     Если игрок новый — создаём его.
                    */

                    if (!player) {
                        player = await createPlayer(user);

                        /*
                         Проверяем реферальную ссылку
                         вида /start ref_123456
                        */

                        const parts = text.trim().split(/\s+/);
                        const startParam = parts[1] || "";

                        if (startParam.startsWith("ref_")) {
                            const inviterId = Number(
                                startParam.substring(4)
                            );

                            if (
                                inviterId &&
                                inviterId !== Number(user.id)
                            ) {
                                const { data: existingReferral } =
                                    await supabase
                                        .from("referrals")
                                        .select("id")
                                        .eq(
                                            "invited_telegram_id",
                                            user.id
                                        )
                                        .maybeSingle();

                                if (!existingReferral) {
                                    /*
                                     Новый игрок получает +100 ⭐
                                    */

                                    await supabase
                                        .from("players")
                                        .update({
                                            balance:
                                                Number(player.balance) + 100
                                        })
                                        .eq(
                                            "telegram_id",
                                            user.id
                                        );

                                    /*
                                     Создаём запись реферала
                                    */

                                    await supabase
                                        .from("referrals")
                                        .insert({
                                            inviter_telegram_id:
                                                inviterId,
                                            invited_telegram_id:
                                                user.id,
                                            reward_paid: false
                                        });

                                    /*
                                     Считаем приглашённых
                                    */

                                    const { count } =
                                        await supabase
                                            .from("referrals")
                                            .select(
                                                "*",
                                                {
                                                    count: "exact",
                                                    head: true
                                                }
                                            )
                                            .eq(
                                                "inviter_telegram_id",
                                                inviterId
                                            );

                                    const invitedCount =
                                        Number(count || 0);

                                    /*
                                     Награды:
                                     2 = 500
                                     4 = 1000
                                     6 = 4000
                                     8 = 7000
                                     10 = 1000
                                    */

                                    const rewards = {
                                        2: 500,
                                        4: 1000,
                                        6: 4000,
                                        8: 7000,
                                        10: 1000
                                    };

                                    const inviterReward =
                                        rewards[invitedCount] || 0;

                                    if (inviterReward > 0) {
                                        const inviter =
                                            await getPlayer(
                                                inviterId
                                            );

                                        if (inviter) {
                                            await supabase
                                                .from("players")
                                                .update({
                                                    balance:
                                                        Number(
                                                            inviter.balance
                                                        ) +
                                                        inviterReward
                                                })
                                                .eq(
                                                    "telegram_id",
                                                    inviterId
                                                );
                                        }
                                    }
                                }
                            }
                        }
                    }

                    /*
                     Отправляем кнопку открытия игры
                    */

                    await telegramRequest("sendMessage", {
                        chat_id: message.chat.id,
                        text:
                            "🎮 Добро пожаловать в RaneGame!",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: "🎮 Открыть игру",
                                        web_app: {
                                            url:
                                                "https://ranegame.onrender.com"
                                        }
                                    }
                                ]
                            ]
                        }
                    });

                } catch (error) {
                    console.error("START ERROR:", error);
                }
            }
        }

    } catch (error) {
        console.error("TELEGRAM POLLING ERROR:", error);
    }
}

/* =========================================================
   ЗАПУСК СЕРВЕРА
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 RaneGame запущен на порту ${PORT}`);

    setInterval(
        processTelegramUpdates,
        1000
    );

    processTelegramUpdates();
});
