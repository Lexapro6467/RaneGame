const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Нет SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

if (!BOT_TOKEN) {
    console.error("❌ Нет BOT_TOKEN");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
);

/* =========================================================
   TELEGRAM WEB APP AUTH
========================================================= */

function validateTelegramWebApp(initData) {
    if (!initData || typeof initData !== "string") {
        return null;
    }

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) {
        return null;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
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

    if (calculatedHash !== hash) {
        return null;
    }

    const authDate = Number(params.get("auth_date"));

    if (!authDate) {
        return null;
    }

    // Данные старше 24 часов считаем недействительными
    if (Math.floor(Date.now() / 1000) - authDate > 86400) {
        return null;
    }

    try {
        return JSON.parse(params.get("user"));
    } catch {
        return null;
    }
}

/* =========================================================
   SUPABASE HELPERS
========================================================= */

async function getPlayer(telegramId) {
    const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();

    if (error) {
        console.error("getPlayer:", error);
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
        // Если игрок уже существует — просто возвращаем его
        if (error.code === "23505") {
            return await getPlayer(user.id);
        }

        console.error("createPlayer:", error);
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

async function updatePlayer(telegramId, updates) {
    const { data, error } = await supabase
        .from("players")
        .update(updates)
        .eq("telegram_id", telegramId)
        .select()
        .single();

    if (error) {
        console.error("updatePlayer:", error);
        throw error;
    }

    return data;
}

/* =========================================================
   STATUS
========================================================= */

app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        server: "RaneGame",
        time: new Date().toISOString()
    });
});

/* =========================================================
   PLAYER
========================================================= */

app.post("/api/player", async (req, res) => {
    try {
        const initData = req.body?.initData;

        const user = validateTelegramWebApp(initData);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Неверные данные Telegram"
            });
        }

        const player = await getOrCreatePlayer(user);

        res.json({
            ok: true,
            player
        });

    } catch (error) {
        console.error("/api/player:", error);

        res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });
    }
});

/* =========================================================
   GET PLAYER
========================================================= */

app.post("/api/me", async (req, res) => {
    try {
        const user = validateTelegramWebApp(req.body?.initData);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Неверные данные Telegram"
            });
        }

        const player = await getOrCreatePlayer(user);

        res.json({
            ok: true,
            player
        });

    } catch (error) {
        console.error("/api/me:", error);

        res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });
    }
});

/* =========================================================
   WEEKLY BONUS +1000
   РАЗ В 7 ДНЕЙ
========================================================= */

app.post("/api/collect", async (req, res) => {
    try {
        const user = validateTelegramWebApp(req.body?.initData);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Неверные данные Telegram"
            });
        }

        const player = await getOrCreatePlayer(user);

        const now = Date.now();
        const WEEK = 7 * 24 * 60 * 60 * 1000;

        if (player.bonus_claimed_at) {
            const lastClaim =
                new Date(player.bonus_claimed_at).getTime();

            const difference = now - lastClaim;

            if (difference < WEEK) {
                const nextClaim =
                    new Date(lastClaim + WEEK).toISOString();

                return res.status(400).json({
                    ok: false,
                    error: "Бонус ещё недоступен",
                    nextClaimAt: nextClaim,
                    reward: 1000
                });
            }
        }

        const newBalance =
            Number(player.balance || 0) + 1000;

        const claimedAt =
            new Date().toISOString();

        const updated = await updatePlayer(user.id, {
            balance: newBalance,
            bonus_claimed_at: claimedAt
        });

        res.json({
            ok: true,
            player: updated,
            reward: 1000,
            nextClaimAt:
                new Date(Date.now() + WEEK).toISOString()
        });

    } catch (error) {
        console.error("/api/collect:", error);

        res.status(500).json({
            ok: false,
            error: "Ошибка выдачи бонуса"
        });
    }
});

/* =========================================================
   ROULETTE
========================================================= */

const ROULETTE_MULTIPLIERS = [
    0.1,
    0.2,
    0.3,
    0.5,
    0.7,
    1.0,
    1.2,
    1.5,
    1.8,
    2.0
];

function getRandomMultiplier() {
    const index = Math.floor(
        Math.random() * ROULETTE_MULTIPLIERS.length
    );

    return ROULETTE_MULTIPLIERS[index];
}

function signRouletteResult(data) {
    return crypto
        .createHmac("sha256", BOT_TOKEN)
        .update(JSON.stringify(data))
        .digest("hex");
}

/* -------------------------
   SPIN
------------------------- */

app.post("/api/roulette/spin", async (req, res) => {
    try {
        const user = validateTelegramWebApp(req.body?.initData);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Неверные данные Telegram"
            });
        }

        const player = await getOrCreatePlayer(user);

        if (
            player.economy_expires_at &&
            new Date(player.economy_expires_at).getTime() >
                Date.now()
        ) {
            return res.status(400).json({
                ok: false,
                error: "Множитель уже активен",
                expiresAt: player.economy_expires_at
            });
        }

        const multiplier = getRandomMultiplier();

        const result = {
            multiplier,
            createdAt: Date.now()
        };

        const signature =
            signRouletteResult(result);

        res.json({
            ok: true,
            multiplier,
            signature
        });

    } catch (error) {
        console.error("/api/roulette/spin:", error);

        res.status(500).json({
            ok: false,
            error: "Ошибка рулетки"
        });
    }
});

/* -------------------------
   CLAIM ROULETTE
------------------------- */

app.post("/api/roulette/claim", async (req, res) => {
    try {
        const user = validateTelegramWebApp(req.body?.initData);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Неверные данные Telegram"
            });
        }

        const {
            multiplier,
            signature
        } = req.body;

        const result = {
            multiplier: Number(multiplier),
            createdAt: Number(req.body?.createdAt)
        };

        const expectedSignature =
            signRouletteResult(result);

        /*
         Если фронтенд не передаёт createdAt,
         поддерживаем старый вариант подписи.
        */
        let validSignature = false;

        if (req.body?.createdAt) {
            validSignature =
                signature === expectedSignature;
        } else {
            const simpleResult = {
                multiplier: Number(multiplier)
            };

            const simpleSignature =
                signRouletteResult(simpleResult);

            validSignature =
                signature === simpleSignature;
        }

        if (!validSignature) {
            return res.status(400).json({
                ok: false,
                error: "Неверная подпись рулетки"
            });
        }

        if (
            !ROULETTE_MULTIPLIERS.includes(
                Number(multiplier)
            )
        ) {
            return res.status(400).json({
                ok: false,
                error: "Неверный множитель"
            });
        }

        const player = await getOrCreatePlayer(user);

        if (
            player.economy_expires_at &&
            new Date(player.economy_expires_at).getTime() >
                Date.now()
        ) {
            return res.status(400).json({
                ok: false,
                error: "Множитель уже активен"
            });
        }

        const expiresAt =
            new Date(
                Date.now() + 4 * 60 * 60 * 1000
            ).toISOString();

        const updated =
            await updatePlayer(user.id, {
                economy_multiplier: Number(multiplier),
                economy_expires_at: expiresAt
            });

        res.json({
            ok: true,
            player: updated,
            multiplier: Number(multiplier),
            expiresAt
        });

    } catch (error) {
        console.error("/api/roulette/claim:", error);

        res.status(500).json({
            ok: false,
            error: "Ошибка активации множителя"
        });
    }
});

/* =========================================================
   BUY
========================================================= */

app.post("/api/buy", async (req, res) => {
    try {
        const user = validateTelegramWebApp(req.body?.initData);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: "Неверные данные Telegram"
            });
        }

        const player = await getOrCreatePlayer(user);

        const price = Number(
            req.body?.price ??
            req.body?.cost ??
            0
        );

        const incomeAdd = Number(
            req.body?.income ??
            req.body?.incomeAdd ??
            0
        );

        if (!Number.isFinite(price) || price <= 0) {
            return res.status(400).json({
                ok: false,
                error: "Неверная цена"
            });
        }

        if (!Number.isFinite(incomeAdd) || incomeAdd < 0) {
            return res.status(400).json({
                ok: false,
                error: "Неверный доход"
            });
        }

        const balance =
            Number(player.balance || 0);

        if (balance < price) {
            return res.status(400).json({
                ok: false,
                error: "Недостаточно ⭐"
            });
        }

        const updated =
            await updatePlayer(user.id, {
                balance: balance - price,
                income:
                    Number(player.income || 0) +
                    incomeAdd
            });

        res.json({
            ok: true,
            player: updated
        });

    } catch (error) {
        console.error("/api/buy:", error);

        res.status(500).json({
            ok: false,
            error: "Ошибка покупки"
        });
    }
});

/* =========================================================
   REFERRALS
========================================================= */

/*
   Награды пригласившему:

   1  -> 0
   2  -> 500
   3  -> 0
   4  -> 1000
   5  -> 0
   6  -> 4000
   7  -> 0
   8  -> 7000
   9  -> 0
   10 -> 1000

   После 10 -> 0

   Новый игрок:
   +100 ⭐
*/

const REFERRAL_REWARDS = {
    1: 0,
    2: 500,
    3: 0,
    4: 1000,
    5: 0,
    6: 4000,
    7: 0,
    8: 7000,
    9: 0,
    10: 1000
};

async function getReferralCount(inviterTelegramId) {
    const { count, error } = await supabase
        .from("referrals")
        .select("id", {
            count: "exact",
            head: true
        })
        .eq(
            "inviter_telegram_id",
            inviterTelegramId
        );

    if (error) {
        console.error(
            "getReferralCount:",
            error
        );
        throw error;
    }

    return count || 0;
}

async function addReferral(
    inviterTelegramId,
    invitedTelegramId
) {
    // Сам себя пригласить нельзя
    if (
        String(inviterTelegramId) ===
        String(invitedTelegramId)
    ) {
        return {
            ok: false,
            reason: "self"
        };
    }

    // Проверяем пригласившего
    const inviter =
        await getPlayer(inviterTelegramId);

    if (!inviter) {
        return {
            ok: false,
            reason: "inviter_not_found"
        };
    }

    // Проверяем, не был ли этот игрок
    // уже приглашён кем-то
    const { data: existing, error: existingError } =
        await supabase
            .from("referrals")
            .select("*")
            .eq(
                "invited_telegram_id",
                invitedTelegramId
            )
            .maybeSingle();

    if (existingError) {
        console.error(
            "check referral:",
            existingError
        );

        return {
            ok: false,
            reason: "database_error"
        };
    }

    if (existing) {
        return {
            ok: false,
            reason: "already_referred"
        };
    }

    /*
       Игрок должен существовать.
       Если он пришёл через Telegram /start раньше,
       чем открыл Mini App — создаём его здесь.
    */

    let invited =
        await getPlayer(invitedTelegramId);

    if (!invited) {
        return {
            ok: false,
            reason: "invited_player_not_found"
        };
    }

    // Считаем номер приглашения
    const referralNumber =
        (await getReferralCount(
            inviterTelegramId
        )) + 1;

    // После 10-го больше ничего не выдаём,
    // но сам реферал всё равно записывается.
    const reward =
        REFERRAL_REWARDS[referralNumber] || 0;

    // Записываем реферала
    const { data: referral, error: insertError } =
        await supabase
            .from("referrals")
            .insert({
                inviter_telegram_id:
                    inviterTelegramId,

                invited_telegram_id:
                    invitedTelegramId,

                reward_paid: true
            })
            .select()
            .single();

    if (insertError) {
        /*
           Если другой запрос успел записать
           этого человека раньше — повторно
           ничего не выдаём.
        */
        if (insertError.code === "23505") {
            return {
                ok: false,
                reason: "already_referred"
            };
        }

        console.error(
            "insert referral:",
            insertError
        );

        return {
            ok: false,
            reason: "database_error"
        };
    }

    // +100 ⭐ НОВОМУ ИГРОКУ
    const invitedBalance =
        Number(invited.balance || 0) + 100;

    await updatePlayer(
        invitedTelegramId,
        {
            balance: invitedBalance
        }
    );

    // Награда пригласившему
    if (reward > 0) {
        const inviterBalance =
            Number(inviter.balance || 0) +
            reward;

        await updatePlayer(
            inviterTelegramId,
            {
                balance: inviterBalance
            }
        );
    }

    return {
        ok: true,
        referral,
        referralNumber,
        invitedReward: 100,
        inviterReward: reward
    };
}

/* =========================================================
   TELEGRAM BOT POLLING
========================================================= */

let telegramOffset = 0;
let telegramPolling = false;

async function telegramRequest(
    method,
    body = {}
) {
    const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/json"
            },
            body: JSON.stringify(body)
        }
    );

    return await response.json();
}

async function processTelegramUpdate(update) {
    const message = update?.message;

    if (!message) {
        return;
    }

    const text =
        typeof message.text === "string"
            ? message.text.trim()
            : "";

    if (!text) {
        return;
    }

    /*
       Обрабатываем:

       /start
       /start ref_123456
    */

    if (!text.startsWith("/start")) {
        return;
    }

    const parts = text.split(/\s+/);

    const startParameter =
        parts[1] || "";

    if (
        !startParameter.startsWith("ref_")
    ) {
        return;
    }

    const inviterTelegramId =
        Number(
            startParameter.substring(4)
        );

    const invitedTelegramId =
        Number(message.from?.id);

    if (
        !Number.isFinite(
            inviterTelegramId
        ) ||
        !Number.isFinite(
            invitedTelegramId
        )
    ) {
        return;
    }

    if (
        inviterTelegramId ===
        invitedTelegramId
    ) {
        return;
    }

    /*
       ВАЖНО:
       Если человек ещё не открывал Mini App,
       его player может ещё не существовать.

       Поэтому создаём его прямо из Telegram.
    */

    const telegramUser =
        message.from;

    if (telegramUser) {
        await getOrCreatePlayer(
            telegramUser
        );
    }

    const result =
        await addReferral(
            inviterTelegramId,
            invitedTelegramId
        );

    console.log(
        "REFERRAL:",
        {
            inviter:
                inviterTelegramId,

            invited:
                invitedTelegramId,

            result
        }
    );
}

async function startTelegramPolling() {
    if (telegramPolling) {
        return;
    }

    telegramPolling = true;

    console.log(
        "🤖 Telegram referral polling запущен"
    );

    /*
       Переключаем бота на polling.
    */

    try {
        await telegramRequest(
            "deleteWebhook",
            {
                drop_pending_updates: false
            }
        );
    } catch (error) {
        console.error(
            "deleteWebhook:",
            error
        );
    }

    while (telegramPolling) {
        try {
            const result =
                await telegramRequest(
                    "getUpdates",
                    {
                        offset:
                            telegramOffset,
                        timeout: 20,
                        allowed_updates: [
                            "message"
                        ]
                    }
                );

            if (
                !result ||
                !result.ok
            ) {
                console.error(
                    "Telegram getUpdates:",
                    result
                );

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            5000
                        )
                );

                continue;
            }

            const updates =
                result.result || [];

            for (const update of updates) {
                telegramOffset =
                    update.update_id + 1;

                try {
                    await processTelegramUpdate(
                        update
                    );
                } catch (error) {
                    console.error(
                        "processTelegramUpdate:",
                        error
                    );
                }
            }

        } catch (error) {
            console.error(
                "Telegram polling:",
                error
            );

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        5000
                    )
            );
        }
    }
}

/* =========================================================
   FALLBACK
========================================================= */

app.get("*", (req, res) => {
    res.sendFile(
        require("path").join(
            __dirname,
            "index.html"
        )
    );
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
    console.log(
        `🚀 RaneGame запущен на порту ${PORT}`
    );

    startTelegramPolling();
});
