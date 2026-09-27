const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = Number(process.env.PORT) || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;
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

// Через сколько часов подарок можно продать
const GIFT_SELL_DELAY_HOURS = 5;

// Магазин меняется каждые 3 часа
const SHOP_REFRESH_HOURS = 3;

// ======================================================
// РЕФЕРАЛЬНЫЕ НАГРАДЫ
// ======================================================

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
        console.error(
            "Telegram validation error:",
            error
        );

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
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player =
            await getOrCreatePlayer(
                telegramUser
            );

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
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player =
            await getOrCreatePlayer(
                telegramUser
            );

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
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        const player =
            await getOrCreatePlayer(
                telegramUser
            );

        const now = new Date();

        let canCollect = true;

        if (player.bonus_claimed_at) {
            const lastClaim =
                new Date(
                    player.bonus_claimed_at
                );

            const diff =
                now.getTime() -
                lastClaim.getTime();

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
            Number(player.balance) +
            WEEKLY_BONUS;

        const updatedPlayer =
            await updatePlayer(
                telegramUser.id,
                {
                    balance: newBalance,
                    bonus_claimed_at:
                        now.toISOString()
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
// SHOP STATE
// ======================================================

async function getShopState() {
    const { data, error } =
        await supabase
            .from("shop_state")
            .select("*")
            .eq("id", 1)
            .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        const { data: created, error: createError } =
            await supabase
                .from("shop_state")
                .insert({
                    id: 1,
                    updated_at:
                        new Date().toISOString()
                })
                .select()
                .single();

        if (createError) {
            throw createError;
        }

        return created;
    }

    return data;
}

// ======================================================
// ОБНОВЛЕНИЕ МАГАЗИНА
// ======================================================

async function refreshShopIfNeeded() {
    const shopState =
        await getShopState();

    const {
        data: existingShop,
        error: existingShopError
    } = await supabase
        .from("shop_gifts")
        .select("gift_id")
        .eq("shop_id", 1);

    if (existingShopError) {
        throw existingShopError;
    }

    const now = new Date();

    const lastUpdate =
        new Date(
            shopState.updated_at
        );

    const refreshTime =
        SHOP_REFRESH_HOURS *
        60 *
        60 *
        1000;

    const shouldRefresh =
        !existingShop ||
        existingShop.length === 0 ||
        now.getTime() -
            lastUpdate.getTime() >=
            refreshTime;

    if (!shouldRefresh) {
        return shopState;
    }

    const {
        data: allGifts,
        error
    } = await supabase
        .from("gifts")
        .select("*")
        .eq("active", true);

    if (error) {
        throw error;
    }

    if (!allGifts || allGifts.length === 0) {
        return shopState;
    }

    // ==================================================
    // ДЕЛАЕМ БОЛЬШЕ ПОДАРКОВ ПО 15 ⭐
    // ==================================================

    const gifts15 =
        allGifts.filter(
            gift =>
                Number(gift.price) === 15
        );

    const gifts18 =
        allGifts.filter(
            gift =>
                Number(gift.price) === 18
        );

    const gifts22 =
        allGifts.filter(
            gift =>
                Number(gift.price) === 22
        );

    const gifts33 =
        allGifts.filter(
            gift =>
                Number(gift.price) === 33
        );

    function shuffle(array) {
        return [...array].sort(
            () => Math.random() - 0.5
        );
    }

    const selected = [
        ...shuffle(gifts15).slice(0, 10),
        ...shuffle(gifts18).slice(0, 5),
        ...shuffle(gifts22).slice(0, 3),
        ...shuffle(gifts33).slice(0, 2)
    ];

    const uniqueSelected = [
        ...new Map(
            selected.map(
                gift => [gift.id, gift]
            )
        ).values()
    ];

    const finalShop =
        uniqueSelected.slice(0, 20);

    // Удаляем старый ассортимент
    const {
        error: deleteError
    } = await supabase
        .from("shop_gifts")
        .delete()
        .eq("shop_id", 1);

    if (deleteError) {
        throw deleteError;
    }

    const rows =
        finalShop.map(gift => ({
            shop_id: 1,
            gift_id: gift.id
        }));

    if (rows.length > 0) {
        const {
            error: insertError
        } = await supabase
            .from("shop_gifts")
            .insert(rows);

        if (insertError) {
            throw insertError;
        }
    }

    const {
        data: updatedState,
        error: updateError
    } = await supabase
        .from("shop_state")
        .update({
            updated_at:
                now.toISOString()
        })
        .eq("id", 1)
        .select()
        .single();

    if (updateError) {
        throw updateError;
    }

    console.log(
        `🛍️ Shop refreshed: ${finalShop.length} gifts`
    );

    return updatedState;
}

// ======================================================
// SHOP
// ======================================================

app.get("/api/gifts", async (req, res) => {
    try {
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        await refreshShopIfNeeded();

        const {
            data: shopGifts,
            error
        } = await supabase
            .from("shop_gifts")
            .select(`
                gift_id,
                gifts (
                    id,
                    name,
                    emoji,
                    price,
                    income
                )
            `)
            .eq("shop_id", 1);

        if (error) {
            throw error;
        }

        const {
            data: inventory,
            error: inventoryError
        } = await supabase
            .from("player_gifts")
            .select(
                "gift_id, quantity"
            )
            .eq(
                "telegram_id",
                telegramUser.id
            );

        if (inventoryError) {
            throw inventoryError;
        }

        const inventoryMap = {};

        for (
            const item
            of inventory || []
        ) {
            inventoryMap[item.gift_id] =
                Number(item.quantity);
        }

        const shop =
            (shopGifts || [])
                .map(item => {
                    const gift =
                        item.gifts;

                    if (!gift) {
                        return null;
                    }

                    return {
                        id: gift.id,
                        name: gift.name,
                        emoji: gift.emoji,
                        price:
                            Number(
                                gift.price
                            ),
                        income:
                            Number(
                                gift.income || 1
                            ),
                        quantity:
                            inventoryMap[
                                gift.id
                            ] || 0,
                        max_quantity:
                            GIFT_MAX_QUANTITY
                    };
                })
                .filter(Boolean);

        const shopState =
            await getShopState();

        const nextRefresh =
            new Date(
                new Date(
                    shopState.updated_at
                ).getTime() +
                SHOP_REFRESH_HOURS *
                60 *
                60 *
                1000
            );

        res.json({
            ok: true,
            gifts: shop,
            updated_at:
                shopState.updated_at,
            next_refresh_at:
                nextRefresh.toISOString(),
            refresh_hours:
                SHOP_REFRESH_HOURS
        });
    } catch (error) {
        console.error(
            "Shop error:",
            error
        );

        res.status(500).json({
            ok: false,
            error: "Failed to load shop"
        });
    }
});

// ======================================================
// ПОКУПКА ПОДАРКА
// ======================================================

app.post("/api/gifts/buy", async (req, res) => {
    try {
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        const giftId =
            Number(
                req.body.gift_id
            );

        if (!giftId) {
            return res.status(400).json({
                ok: false,
                error:
                    "Gift ID is required"
            });
        }

        await refreshShopIfNeeded();

        const {
            data: shopGift,
            error: shopError
        } = await supabase
            .from("shop_gifts")
            .select("gift_id")
            .eq("shop_id", 1)
            .eq("gift_id", giftId)
            .maybeSingle();

        if (shopError) {
            throw shopError;
        }

        if (!shopGift) {
            return res.status(400).json({
                ok: false,
                error:
                    "Gift is not available in the shop"
            });
        }

        const player =
            await getOrCreatePlayer(
                telegramUser
            );

        const {
            data: gift,
            error: giftError
        } = await supabase
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
                error:
                    "Gift not found"
            });
        }

        const {
            count,
            error: countError
        } = await supabase
            .from("gift_purchases")
            .select("*", {
                count: "exact",
                head: true
            })
            .eq(
                "telegram_id",
                telegramUser.id
            )
            .eq(
                "gift_id",
                giftId
            );

        if (countError) {
            throw countError;
        }

        const currentQuantity =
            Number(count || 0);

        if (
            currentQuantity >=
            GIFT_MAX_QUANTITY
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    "Maximum quantity reached",
                quantity:
                    currentQuantity,
                max_quantity:
                    GIFT_MAX_QUANTITY
            });
        }

        if (
            Number(player.balance) <
            Number(gift.price)
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    "Not enough stars",
                balance:
                    Number(
                        player.balance
                    ),
                price:
                    Number(
                        gift.price
                    )
            });
        }

        const newBalance =
            Number(player.balance) -
            Number(gift.price);

        const newIncome =
            Number(player.income) +
            Number(gift.income || 1);

        const updatedPlayer =
            await updatePlayer(
                telegramUser.id,
                {
                    balance:
                        newBalance,
                    income:
                        newIncome
                }
            );

        const {
            data: purchase,
            error: purchaseError
        } = await supabase
            .from("gift_purchases")
            .insert({
                telegram_id:
                    telegramUser.id,
                gift_id:
                    giftId,
                purchased_at:
                    new Date().toISOString()
            })
            .select()
            .single();

        if (purchaseError) {
            throw purchaseError;
        }

        const {
            data: existingInventory,
            error: invError
        } = await supabase
            .from("player_gifts")
            .select("*")
            .eq(
                "telegram_id",
                telegramUser.id
            )
            .eq(
                "gift_id",
                giftId
            )
            .maybeSingle();

        if (invError) {
            throw invError;
        }

        let inventoryItem;

        if (existingInventory) {
            const {
                data,
                error
            } = await supabase
                .from("player_gifts")
                .update({
                    quantity:
                        Number(
                            existingInventory.quantity
                        ) + 1,
                    purchased_at:
                        new Date().toISOString()
                })
                .eq(
                    "id",
                    existingInventory.id
                )
                .select()
                .single();

            if (error) {
                throw error;
            }

            inventoryItem = data;
        } else {
            const {
                data,
                error
            } = await supabase
                .from("player_gifts")
                .insert({
                    telegram_id:
                        telegramUser.id,
                    gift_id:
                        giftId,
                    quantity: 1,
                    purchased_at:
                        new Date().toISOString()
                })
                .select()
                .single();

            if (error) {
                throw error;
            }

            inventoryItem = data;
        }

        res.json({
            ok: true,
            message:
                "Gift purchased",
            gift,
            purchase,
            quantity:
                currentQuantity + 1,
            max_quantity:
                GIFT_MAX_QUANTITY,
            player:
                updatedPlayer,
            inventory:
                inventoryItem
        });
    } catch (error) {
        console.error(
            "Buy gift error:",
            error
        );

        res.status(500).json({
            ok: false,
            error:
                "Failed to buy gift"
        });
    }
});

// ======================================================
// ИНВЕНТАРЬ
// ======================================================

app.get("/api/inventory", async (req, res) => {
    try {
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        const {
            data: purchases,
            error
        } = await supabase
            .from("gift_purchases")
            .select(`
                id,
                gift_id,
                purchased_at,
                gifts (
                    id,
                    name,
                    emoji,
                    price,
                    income
                )
            `)
            .eq(
                "telegram_id",
                telegramUser.id
            )
            .order(
                "purchased_at",
                {
                    ascending: false
                }
            );

        if (error) {
            throw error;
        }

        const now =
            Date.now();

        const inventory =
            (purchases || [])
                .map(purchase => {
                    const gift =
                        purchase.gifts;

                    const purchasedAt =
                        new Date(
                            purchase.purchased_at
                        );

                    const sellAt =
                        new Date(
                            purchasedAt.getTime() +
                            GIFT_SELL_DELAY_HOURS *
                            60 *
                            60 *
                            1000
                        );

                    const canSell =
                        now >=
                        sellAt.getTime();

                    const remainingMs =
                        Math.max(
                            0,
                            sellAt.getTime() -
                            now
                        );

                    return {
                        purchase_id:
                            purchase.id,

                        gift_id:
                            purchase.gift_id,

                        name:
                            gift?.name ||
                            "",

                        emoji:
                            gift?.emoji ||
                            "🎁",

                        price:
                            Number(
                                gift?.price ||
                                0
                            ),

                        income:
                            Number(
                                gift?.income ||
                                1
                            ),

                        purchased_at:
                            purchase.purchased_at,

                        sell_at:
                            sellAt.toISOString(),

                        can_sell:
                            canSell,

                        remaining_seconds:
                            Math.ceil(
                                remainingMs /
                                1000
                            )
                    };
                });

        let totalGiftIncome = 0;

        for (
            const item
            of inventory
        ) {
            totalGiftIncome +=
                Number(
                    item.income
                );
        }

        res.json({
            ok: true,
            inventory,
            total_gift_income:
                totalGiftIncome,
            sell_delay_hours:
                GIFT_SELL_DELAY_HOURS
        });
    } catch (error) {
        console.error(
            "Inventory error:",
            error
        );

        res.status(500).json({
            ok: false,
            error:
                "Failed to load inventory"
        });
    }
});

// ======================================================
// ПРОДАЖА ПОДАРКА
// ======================================================

app.post("/api/gifts/sell", async (req, res) => {
    try {
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        const purchaseId =
            Number(
                req.body.purchase_id
            );

        if (!purchaseId) {
            return res.status(400).json({
                ok: false,
                error:
                    "Purchase ID is required"
            });
        }

        const {
            data: purchase,
            error
        } = await supabase
            .from("gift_purchases")
            .select(`
                id,
                telegram_id,
                gift_id,
                purchased_at,
                gifts (
                    id,
                    name,
                    emoji,
                    price,
                    income
                )
            `)
            .eq(
                "id",
                purchaseId
            )
            .eq(
                "telegram_id",
                telegramUser.id
            )
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!purchase) {
            return res.status(404).json({
                ok: false,
                error:
                    "Purchase not found"
            });
        }

        const purchasedAt =
            new Date(
                purchase.purchased_at
            );

        const sellAt =
            new Date(
                purchasedAt.getTime() +
                GIFT_SELL_DELAY_HOURS *
                60 *
                60 *
                1000
            );

        const now =
            new Date();

        if (
            now.getTime() <
            sellAt.getTime()
        ) {
            const remainingMs =
                sellAt.getTime() -
                now.getTime();

            return res.status(400).json({
                ok: false,
                error:
                    "Gift cannot be sold yet",
                can_sell:
                    false,
                sell_at:
                    sellAt.toISOString(),
                remaining_seconds:
                    Math.ceil(
                        remainingMs /
                        1000
                    )
            });
        }

        const gift =
            purchase.gifts;

        const sellPrice =
            Number(
                gift?.price || 0
            );

        const player =
            await getOrCreatePlayer(
                telegramUser
            );

        const {
            error: deleteError
        } = await supabase
            .from("gift_purchases")
            .delete()
            .eq(
                "id",
                purchaseId
            )
            .eq(
                "telegram_id",
                telegramUser.id
            );

        if (deleteError) {
            throw deleteError;
        }

        const {
            data: existingInventory,
            error: invError
        } = await supabase
            .from("player_gifts")
            .select("*")
            .eq(
                "telegram_id",
                telegramUser.id
            )
            .eq(
                "gift_id",
                purchase.gift_id
            )
            .maybeSingle();

        if (invError) {
            throw invError;
        }

        if (existingInventory) {
            const newQuantity =
                Number(
                    existingInventory.quantity
                ) - 1;

            if (newQuantity <= 0) {
                const {
                    error
                } = await supabase
                    .from("player_gifts")
                    .delete()
                    .eq(
                        "id",
                        existingInventory.id
                    );

                if (error) {
                    throw error;
                }
            } else {
                const {
                    error
                } = await supabase
                    .from("player_gifts")
                    .update({
                        quantity:
                            newQuantity
                    })
                    .eq(
                        "id",
                        existingInventory.id
                    );

                if (error) {
                    throw error;
                }
            }
        }

        const newBalance =
            Number(player.balance) +
            sellPrice;

        const newIncome =
            Math.max(
                0,
                Number(player.income) -
                Number(
                    gift?.income || 1
                )
            );

        const updatedPlayer =
            await updatePlayer(
                telegramUser.id,
                {
                    balance:
                        newBalance,
                    income:
                        newIncome
                }
            );

        res.json({
            ok: true,
            message:
                "Gift sold",
            sold_price:
                sellPrice,
            player:
                updatedPlayer
        });
    } catch (error) {
        console.error(
            "Sell gift error:",
            error
        );

        res.status(500).json({
            ok: false,
            error:
                "Failed to sell gift"
        });
    }
});

// ======================================================
// ОБЫЧНЫЕ ПОКУПКИ
// ======================================================

app.post("/api/buy", async (req, res) => {
    try {
        const telegramUser =
            requireTelegramUser(req, res);

        if (!telegramUser) return;

        const amount =
            Number(
                req.body.amount || 0
            );

        if (amount <= 0) {
            return res.status(400).json({
                ok: false,
                error:
                    "Invalid amount"
            });
        }

        const player =
            await getOrCreatePlayer(
                telegramUser
            );

        if (
            Number(player.balance) <
            amount
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    "Not enough stars"
            });
        }

        const updatedPlayer =
            await updatePlayer(
                telegramUser.id,
                {
                    balance:
                        Number(
                            player.balance
                        ) -
                        amount
                }
            );

        res.json({
            ok: true,
            player:
                updatedPlayer
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error:
                "Purchase failed"
        });
    }
});

// ======================================================
// РУЛЕТКА
// ======================================================

app.post(
    "/api/roulette/spin",
    async (req, res) => {
        try {
            const telegramUser =
                requireTelegramUser(
                    req,
                    res
                );

            if (!telegramUser) return;

            const player =
                await getOrCreatePlayer(
                    telegramUser
                );

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
                        Math.random() *
                        multipliers.length
                    )
                ];

            const expiresAt =
                new Date(
                    Date.now() +
                    4 *
                    60 *
                    60 *
                    1000
                );

            const updatedPlayer =
                await updatePlayer(
                    telegramUser.id,
                    {
                        economy_multiplier:
                            multiplier,

                        economy_expires_at:
                            expiresAt.toISOString()
                    }
                );

            res.json({
                ok: true,
                multiplier,
                expires_at:
                    expiresAt.toISOString(),
                player:
                    updatedPlayer
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                ok: false,
                error:
                    "Roulette failed"
            });
        }
    }
);

app.post(
    "/api/roulette/claim",
    async (req, res) => {
        try {
            const telegramUser =
                requireTelegramUser(
                    req,
                    res
                );

            if (!telegramUser) return;

            const player =
                await getOrCreatePlayer(
                    telegramUser
                );

            const multiplier =
                Number(
                    player.economy_multiplier ||
                    1
                );

            const expiresAt =
                player.economy_expires_at
                    ? new Date(
                        player.economy_expires_at
                    )
                    : null;

            if (
                !expiresAt ||
                expiresAt < new Date()
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Multiplier expired"
                });
            }

            res.json({
                ok: true,
                multiplier,
                expires_at:
                    expiresAt.toISOString(),
                player
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                ok: false,
                error:
                    "Roulette claim failed"
            });
        }
    }
);

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
        await getPlayer(
            inviterTelegramId
        );

    if (!inviter) {
        return {
            ok: false,
            reason:
                "inviter_not_found"
        };
    }

    const {
        data: existingReferral,
        error: existingError
    } = await supabase
        .from("referrals")
        .select("*")
        .eq(
            "invited_telegram_id",
            invitedTelegramId
        )
        .maybeSingle();

    if (existingError) {
        throw existingError;
    }

    if (existingReferral) {
        return {
            ok: false,
            reason:
                "already_referred"
        };
    }

    const {
        count,
        error: countError
    } = await supabase
        .from("referrals")
        .select("*", {
            count: "exact",
            head: true
        })
        .eq(
            "inviter_telegram_id",
            inviterTelegramId
        );

    if (countError) {
        throw countError;
    }

    const referralNumber =
        Number(count || 0) + 1;

    const {
        error: insertError
    } = await supabase
        .from("referrals")
        .insert({
            inviter_telegram_id:
                inviterTelegramId,

            invited_telegram_id:
                invitedTelegramId,

            reward_paid:
                true
        });

    if (insertError) {
        throw insertError;
    }

    const invited =
        await getPlayer(
            invitedTelegramId
        );

    if (invited) {
        await updatePlayer(
            invitedTelegramId,
            {
                balance:
                    Number(
                        invited.balance
                    ) + 100
            }
        );
    }

    const reward =
        REFERRAL_REWARDS[
            referralNumber
        ] || 0;

    if (reward > 0) {
        await updatePlayer(
            inviterTelegramId,
            {
                balance:
                    Number(
                        inviter.balance
                    ) + reward
            }
        );
    }

    return {
        ok: true,
        referral_number:
            referralNumber,
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

    const response =
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body:
                    JSON.stringify(body)
            }
        );

    return response.json();
}

async function processTelegramUpdate(
    update
) {
    try {
        const message =
            update.message;

        if (
            !message ||
            !message.text
        ) {
            return;
        }

        const text =
            message.text.trim();

        if (
            !text.startsWith("/start")
        ) {
            return;
        }

        const parts =
            text.split(/\s+/);

        const startParameter =
            parts[1] || "";

        if (
            !startParameter.startsWith(
                "ref_"
            )
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

        await getOrCreatePlayer(
            invitedUser
        );

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
                drop_pending_updates:
                    false
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

                            timeout:
                                30,

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
                    const update
                    of result.result
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
            "RaneGame_index.html"
        )
    );
});

// ======================================================
// START
// ======================================================

const server =
    app.listen(
        PORT,
        "0.0.0.0",
        () => {
            console.log(
                `🚀 RaneGame server started on port ${PORT}`
            );

            // Telegram запускаем ПОСЛЕ открытия порта
            startTelegramPolling();
        }
    );

server.on(
    "error",
    error => {
        console.error(
            "❌ Server error:",
            error
        );
    }
);
