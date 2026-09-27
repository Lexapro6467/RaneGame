const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

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
    console.error("❌ Supabase environment variables are missing");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
);

// ======================================================
// НАСТРОЙКИ
// ======================================================

const WEEKLY_BONUS = 1000;
const GIFT_MAX_QUANTITY = 5;

// Награды за приглашения
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

// ======================================================
// TELEGRAM WEB APP ПРОВЕРКА
// ======================================================

function validateTelegramInitData(initData) {
    if (!initData || !BOT_TOKEN) {
        return null;
    }

    try {
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

        const userString = params.get("user");

        if (!userString) {
            return null;
        }

        return JSON.parse(userString);

    } catch (error) {
        console.error("Telegram validation error:", error);
        return null;
    }
}

function getTelegramUser(req) {
    const initData =
        req.headers["x-telegram-init-data"] ||
        req.body?.initData ||
        req.query?.initData;

    return validateTelegramInitData(initData);
}

function requireTelegramUser(req, res) {
    const user = getTelegramUser(req);

    if (!user) {
        res.status(401).json({
            ok: false,
            error: "Telegram authorization required"
        });

        return null;
    }

    return user;
}

// ======================================================
// PLAYER
// ======================================================

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

async function createPlayer(telegramUser) {
    const { data, error } = await supabase
        .from("players")
        .insert({
            telegram_id: telegramUser.id,
            username: telegramUser.username || null,
            first_name: telegramUser.first_name || "",
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

async function getOrCreatePlayer(telegramUser) {
    let player = await getPlayer(telegramUser.id);

    if (!player) {
        player = await createPlayer(telegramUser);
    }

    return player;
}

async function updatePlayer(telegramId, values) {
    const { data, error } = await supabase
        .from("players")
        .update(values)
        .eq("telegram_id", telegramId)
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
}

// ======================================================
// STATUS
// ======================================================

app.get("/api/status", async (req, res) => {
    res.json({
        ok: true,
        game: "RaneGame"
    });
});

// ======================================================
// PLAYER
// ======================================================

app.get("/api/player", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player = await getOrCreatePlayer(telegramUser);

        res.json({
            ok: true,
            player
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Failed to get player"
        });
    }
});

app.get("/api/me", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player = await getOrCreatePlayer(telegramUser);

        res.json({
            ok: true,
            player
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Failed to get player"
        });
    }
});

// ======================================================
// WEEKLY BONUS
// ======================================================

app.post("/api/collect", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player = await getOrCreatePlayer(telegramUser);

        const now = new Date();

        let canCollect = true;

        if (player.bonus_claimed_at) {
            const lastClaim = new Date(player.bonus_claimed_at);

            const diff =
                now.getTime() - lastClaim.getTime();

            const sevenDays =
                7 * 24 * 60 * 60 * 1000;

            if (diff < sevenDays) {
                canCollect = false;
            }
        }

        if (!canCollect) {
            return res.status(400).json({
                ok: false,
                error: "Bonus is not ready yet"
            });
        }

        const newBalance =
            Number(player.balance) + WEEKLY_BONUS;

        const updatedPlayer = await updatePlayer(
            telegramUser.id,
            {
                balance: newBalance,
                bonus_claimed_at: now.toISOString()
            }
        );

        res.json({
            ok: true,
            reward: WEEKLY_BONUS,
            player: updatedPlayer
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Failed to collect bonus"
        });
    }
});

// ======================================================
// SHOP — ПОДАРКИ
// ======================================================

app.get("/api/gifts", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const { data: gifts, error } = await supabase
            .from("gifts")
            .select("*")
            .eq("active", true)
            .order("price", {
                ascending: true
            });

        if (error) {
            throw error;
        }

        const { data: inventory, error: inventoryError } =
            await supabase
                .from("player_gifts")
                .select("gift_id, quantity")
                .eq("telegram_id", telegramUser.id);

        if (inventoryError) {
            throw inventoryError;
        }

        const inventoryMap = {};

        for (const item of inventory || []) {
            inventoryMap[item.gift_id] = item.quantity;
        }

        const result = (gifts || []).map(gift => ({
            ...gift,
            quantity: inventoryMap[gift.id] || 0,
            max_quantity: GIFT_MAX_QUANTITY
        }));

        res.json({
            ok: true,
            gifts: result
        });

    } catch (error) {
        console.error("Gifts error:", error);

        res.status(500).json({
            ok: false,
            error: "Failed to load gifts"
        });
    }
});

// ======================================================
// ПОКУПКА ПОДАРКА
// ======================================================

app.post("/api/gifts/buy", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const giftId = Number(req.body.gift_id);

        if (!giftId) {
            return res.status(400).json({
                ok: false,
                error: "Gift ID is required"
            });
        }

        // Получаем игрока
        const player = await getOrCreatePlayer(telegramUser);

        // Получаем подарок
        const { data: gift, error: giftError } =
            await supabase
                .from("gifts")
                .select("*")
                .eq("id", giftId)
                .eq("active", true)
                .maybeSingle();

        if (giftError) {
            throw giftError;
        }

        if (!gift) {
            return res.status(404).json({
                ok: false,
                error: "Gift not found"
            });
        }

        // Получаем текущий инвентарь
        const { data: existingGift, error: inventoryError } =
            await supabase
                .from("player_gifts")
                .select("*")
                .eq("telegram_id", telegramUser.id)
                .eq("gift_id", giftId)
                .maybeSingle();

        if (inventoryError) {
            throw inventoryError;
        }

        const currentQuantity =
            existingGift?.quantity || 0;

        // Максимум 5 одинаковых подарков
        if (currentQuantity >= GIFT_MAX_QUANTITY) {
            return res.status(400).json({
                ok: false,
                error: "Maximum quantity reached",
                quantity: currentQuantity,
                max_quantity: GIFT_MAX_QUANTITY
            });
        }

        // Проверяем баланс
        if (Number(player.balance) < Number(gift.price)) {
            return res.status(400).json({
                ok: false,
                error: "Not enough stars",
                balance: player.balance,
                price: gift.price
            });
        }

        // Списываем ⭐
        const newBalance =
            Number(player.balance) - Number(gift.price);

        // +1 ⭐/час за каждый подарок
        const newIncome =
            Number(player.income) + Number(gift.income || 1);

        const updatedPlayer = await updatePlayer(
            telegramUser.id,
            {
                balance: newBalance,
                income: newIncome
            }
        );

        // Добавляем подарок в инвентарь
        let updatedGift;

        if (existingGift) {

            updatedGift = await supabase
                .from("player_gifts")
                .update({
                    quantity: currentQuantity + 1
                })
                .eq("id", existingGift.id)
                .select()
                .single();

        } else {

            updatedGift = await supabase
                .from("player_gifts")
                .insert({
                    telegram_id: telegramUser.id,
                    gift_id: giftId,
                    quantity: 1
                })
                .select()
                .single();
        }

        if (updatedGift.error) {
            throw updatedGift.error;
        }

        res.json({
            ok: true,
            message: "Gift purchased",
            gift,
            quantity: currentQuantity + 1,
            max_quantity: GIFT_MAX_QUANTITY,
            player: updatedPlayer
        });

    } catch (error) {
        console.error("Buy gift error:", error);

        res.status(500).json({
            ok: false,
            error: "Failed to buy gift"
        });
    }
});

// ======================================================
// ИНВЕНТАРЬ
// ======================================================

app.get("/api/inventory", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const { data, error } = await supabase
            .from("player_gifts")
            .select(`
                id,
                quantity,
                gift_id,
                gifts (
                    id,
                    name,
                    emoji,
                    price,
                    income
                )
            `)
            .eq("telegram_id", telegramUser.id)
            .order("created_at", {
                ascending: true
            });

        if (error) {
            throw error;
        }

        let totalGiftIncome = 0;

        const inventory = (data || []).map(item => {

            const gift = item.gifts;

            const income =
                Number(gift?.income || 1) *
                Number(item.quantity);

            totalGiftIncome += income;

            return {
                id: item.id,
                gift_id: item.gift_id,
                name: gift?.name || "",
                emoji: gift?.emoji || "🎁",
                price: gift?.price || 0,
                income: gift?.income || 1,
                quantity: item.quantity,
                max_quantity: GIFT_MAX_QUANTITY,
                total_income: income
            };
        });

        res.json({
            ok: true,
            inventory,
            total_gift_income: totalGiftIncome
        });

    } catch (error) {
        console.error("Inventory error:", error);

        res.status(500).json({
            ok: false,
            error: "Failed to load inventory"
        });
    }
});

// ======================================================
// ПОКУПКИ
// ======================================================

app.post("/api/buy", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const amount = Number(req.body.amount || 0);

        if (amount <= 0) {
            return res.status(400).json({
                ok: false,
                error: "Invalid amount"
            });
        }

        const player = await getOrCreatePlayer(telegramUser);

        if (Number(player.balance) < amount) {
            return res.status(400).json({
                ok: false,
                error: "Not enough stars"
            });
        }

        const updatedPlayer = await updatePlayer(
            telegramUser.id,
            {
                balance:
                    Number(player.balance) - amount
            }
        );

        res.json({
            ok: true,
            player: updatedPlayer
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Purchase failed"
        });
    }
});

// ======================================================
// РУЛЕТКА
// ======================================================

app.post("/api/roulette/spin", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player = await getOrCreatePlayer(telegramUser);

        const multipliers = [
            0.1,
            0.2,
            0.5,
            0.8,
            1.0,
            1.2,
            1.5,
            2.0
        ];

        const multiplier =
            multipliers[
                Math.floor(
                    Math.random() * multipliers.length
                )
            ];

        const expiresAt = new Date(
            Date.now() + 4 * 60 * 60 * 1000
        );

        const updatedPlayer = await updatePlayer(
            telegramUser.id,
            {
                economy_multiplier: multiplier,
                economy_expires_at:
                    expiresAt.toISOString()
            }
        );

        res.json({
            ok: true,
            multiplier,
            expires_at: expiresAt.toISOString(),
            player: updatedPlayer
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Roulette failed"
        });
    }
});

app.post("/api/roulette/claim", async (req, res) => {
    try {
        const telegramUser = requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player = await getOrCreatePlayer(telegramUser);

        const multiplier =
            Number(player.economy_multiplier || 1);

        const expiresAt =
            player.economy_expires_at
                ? new Date(player.economy_expires_at)
                : null;

        if (!expiresAt || expiresAt < new Date()) {
            return res.status(400).json({
                ok: false,
                error: "Multiplier expired"
            });
        }

        res.json({
            ok: true,
            multiplier,
            expires_at: expiresAt.toISOString(),
            player
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Roulette claim failed"
        });
    }
});

// ======================================================
// РЕФЕРАЛЫ
// ======================================================

async function addReferral(
    inviterTelegramId,
    invitedTelegramId
) {
    if (
        !inviterTelegramId ||
        !invitedTelegramId
    ) {
        return {
            ok: false,
            reason: "invalid"
        };
    }

    if (
        String(inviterTelegramId) ===
        String(invitedTelegramId)
    ) {
        return {
            ok: false,
            reason: "self"
        };
    }

    const inviter =
        await getPlayer(inviterTelegramId);

    if (!inviter) {
        return {
            ok: false,
            reason: "inviter_not_found"
        };
    }

    const { data: existingReferral, error: existingError } =
        await supabase
            .from("referrals")
            .select("*")
            .eq("invited_telegram_id", invitedTelegramId)
            .maybeSingle();

    if (existingError) {
        throw existingError;
    }

    if (existingReferral) {
        return {
            ok: false,
            reason: "already_referred"
        };
    }

    const { count, error: countError } =
        await supabase
            .from("referrals")
            .select("*", {
                count: "exact",
                head: true
            })
            .eq("inviter_telegram_id", inviterTelegramId);

    if (countError) {
        throw countError;
    }

    const referralNumber =
        Number(count || 0) + 1;

    const { error: insertError } =
        await supabase
            .from("referrals")
            .insert({
                inviter_telegram_id:
                    inviterTelegramId,
                invited_telegram_id:
                    invitedTelegramId,
                reward_paid: true
            });

    if (insertError) {
        throw insertError;
    }

    // Новый игрок получает +100 ⭐
    const invited =
        await getPlayer(invitedTelegramId);

    if (invited) {
        await updatePlayer(
            invitedTelegramId,
            {
                balance:
                    Number(invited.balance) + 100
            }
        );
    }

    // Награда пригласившему
    const reward =
        REFERRAL_REWARDS[referralNumber] || 0;

    if (reward > 0) {
        await updatePlayer(
            inviterTelegramId,
            {
                balance:
                    Number(inviter.balance) + reward
            }
        );
    }

    return {
        ok: true,
        referral_number: referralNumber,
        reward
    };
}

// ======================================================
// TELEGRAM BOT
// ======================================================

async function telegramRequest(
    method,
    body = {}
) {
    if (!BOT_TOKEN) {
        return null;
    }

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

    return response.json();
}

async function processTelegramUpdate(update) {
    try {
        const message = update.message;

        if (!message || !message.text) {
            return;
        }

        const text = message.text.trim();

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

        const inviterId =
            Number(
                startParameter.replace(
                    "ref_",
                    ""
                )
            );

        const invitedUser =
            message.from;

        if (!invitedUser) {
            return;
        }

        // Создаём игрока ещё до обработки реферала
        await getOrCreatePlayer(invitedUser);

        const result =
            await addReferral(
                inviterId,
                invitedUser.id
            );

        console.log(
            "Referral result:",
            result
        );

    } catch (error) {
        console.error(
            "Telegram update error:",
            error
        );
    }
}

let telegramOffset = 0;

async function startTelegramPolling() {
    if (!BOT_TOKEN) {
        console.log(
            "⚠️ BOT_TOKEN is not configured"
        );
        return;
    }

    try {
        await telegramRequest(
            "deleteWebhook",
            {
                drop_pending_updates: false
            }
        );

        console.log(
            "🤖 Telegram polling started"
        );

        while (true) {
            try {
                const result =
                    await telegramRequest(
                        "getUpdates",
                        {
                            offset:
                                telegramOffset,
                            timeout: 30,
                            allowed_updates: [
                                "message"
                            ]
                        }
                    );

                if (
                    !result ||
                    !result.ok
                ) {
                    await new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                3000
                            )
                    );

                    continue;
                }

                for (
                    const update of result.result
                ) {
                    telegramOffset =
                        update.update_id + 1;

                    await processTelegramUpdate(
                        update
                    );
                }

            } catch (error) {
                console.error(
                    "Telegram polling error:",
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

    } catch (error) {
        console.error(
            "Failed to start Telegram polling:",
            error
        );
    }
}

// ======================================================
// FALLBACK
// ======================================================

app.get(/.*/, (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );
});

// ======================================================
// START
// ======================================================

app.listen(PORT, () => {
    console.log(
        `🚀 RaneGame server started on port ${PORT}`
    );

    startTelegramPolling();
});
