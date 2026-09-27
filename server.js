const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const BOT_TOKEN =
    process.env.BOT_TOKEN;


/* =========================================================
   ADMIN
========================================================= */

const DEV_TELEGRAM_ID =
    "5370959021438146805";


/* =========================================================
   ПРОВЕРКА ENV
========================================================= */

if (!SUPABASE_URL) {
    console.error("❌ SUPABASE_URL не задан");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
        "❌ SUPABASE_SERVICE_ROLE_KEY не задан"
    );
}

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN не задан");
}


const supabase =
    createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
    );


/* =========================================================
   НАСТРОЙКИ
========================================================= */

const SHOP_REFRESH_MS =
    3 * 60 * 60 * 1000;

const GIFT_SELL_DELAY_MS =
    5 * 60 * 60 * 1000;

const ROULETTE_DURATION_MS =
    4 * 60 * 60 * 1000;


/* =========================================================
   TELEGRAM USER
========================================================= */

function getTelegramUser(req) {

    const user =
        req.body?.user ||
        req.query?.user;

    if (
        !user ||
        !user.id
    ) {
        return null;
    }

    return user;
}


/* =========================================================
   СОЗДАНИЕ / ПОЛУЧЕНИЕ ИГРОКА
========================================================= */

async function getOrCreatePlayer(user) {

    const telegramId =
        Number(user.id);

    if (!telegramId) {
        throw new Error(
            "Не передан Telegram user"
        );
    }

    const {
        data: existing,
        error: findError
    } =
        await supabase
            .from("players")
            .select("*")
            .eq(
                "telegram_id",
                telegramId
            )
            .maybeSingle();

    if (findError) {
        throw findError;
    }

    if (existing) {
        return existing;
    }

    const {
        data: created,
        error: createError
    } =
        await supabase
            .from("players")
            .insert({

                telegram_id:
                    telegramId,

                username:
                    user.username ||
                    null,

                first_name:
                    user.first_name ||
                    "Игрок",

                balance:
                    3918,

                income:
                    201,

                economy_multiplier:
                    1.00,

                economy_expires_at:
                    null

            })
            .select("*")
            .single();

    if (createError) {
        throw createError;
    }

    return created;
}


/* =========================================================
   ПОИСК ИГРОКА
========================================================= */

async function getPlayerByTelegramId(
    telegramId
) {

    const {
        data,
        error
    } =
        await supabase
            .from("players")
            .select("*")
            .eq(
                "telegram_id",
                Number(telegramId)
            )
            .single();

    if (error) {
        throw error;
    }

    return data;
}


/* =========================================================
   ОБНОВЛЕНИЕ ИГРОКА
========================================================= */

async function updatePlayer(
    telegramId,
    values
) {

    const {
        data,
        error
    } =
        await supabase
            .from("players")
            .update(values)
            .eq(
                "telegram_id",
                Number(telegramId)
            )
            .select("*")
            .single();

    if (error) {
        throw error;
    }

    return data;
}


/* =========================================================
   ADMIN — СБРОС МОЕГО АККАУНТА
========================================================= */

app.post(
    "/api/dev/reset-account",
    async (req, res) => {

        try {

            const user =
                req.body?.user;

            /*
               Проверяем Telegram ID
               прямо на сервере.
            */

            if (
                !user ||
                String(user.id) !==
                DEV_TELEGRAM_ID
            ) {

                return res
                    .status(403)
                    .json({

                        ok: false,

                        error:
                            "Доступ запрещён"

                    });

            }


            const telegramId =
                DEV_TELEGRAM_ID;


            /*
               Удаляем отдельные покупки.
            */

            const {
                error: purchasesError
            } =
                await supabase
                    .from("gift_purchases")
                    .delete()
                    .eq(
                        "telegram_id",
                        telegramId
                    );


            if (purchasesError) {
                throw purchasesError;
            }


            /*
               Удаляем инвентарь.
            */

            const {
                error: giftsError
            } =
                await supabase
                    .from("player_gifts")
                    .delete()
                    .eq(
                        "telegram_id",
                        telegramId
                    );


            if (giftsError) {
                throw giftsError;
            }


            /*
               Сбрасываем самого игрока.
            */

            const {
                data: player,
                error: playerError
            } =
                await supabase
                    .from("players")
                    .update({

                        balance:
                            0,

                        income:
                            0,

                        economy_multiplier:
                            1.00,

                        economy_expires_at:
                            null,

                        bonus_claimed_at:
                            null

                    })
                    .eq(
                        "telegram_id",
                        telegramId
                    )
                    .select("*")
                    .single();


            if (playerError) {
                throw playerError;
            }


            return res.json({

                ok: true,

                success: true,

                player

            });

        } catch (error) {

            console.error(
                "RESET ACCOUNT ERROR:",
                error
            );

            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   PLAYER
========================================================= */

app.post(
    "/api/player",
    async (req, res) => {

        try {

            const user =
                getTelegramUser(req);


            if (!user) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан Telegram user"

                    });

            }


            const player =
                await getOrCreatePlayer(
                    user
                );


            return res.json({

                ok: true,

                player

            });

        } catch (error) {

            console.error(
                "PLAYER ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   SHOP STATE
========================================================= */

async function getShopState() {

    const {
        data,
        error
    } =
        await supabase
            .from("shop_state")
            .select("*")
            .eq(
                "id",
                1
            )
            .maybeSingle();


    if (error) {
        throw error;
    }


    if (data) {
        return data;
    }


    const {
        data: created,
        error: createError
    } =
        await supabase
            .from("shop_state")
            .insert({

                id:
                    1,

                updated_at:
                    new Date().toISOString()

            })
            .select("*")
            .single();


    if (createError) {
        throw createError;
    }


    return created;
}


/* =========================================================
   СОЗДАНИЕ НОВОГО АССОРТИМЕНТА
========================================================= */

async function refreshGiftShop() {

    /*
       20 подарков:

       10 × 15 ⭐
       5 × 18 ⭐
       3 × 22 ⭐
       2 × 33 ⭐
    */


    const {
        data: allGifts,
        error
    } =
        await supabase
            .from("gifts")
            .select("*")
            .eq(
                "active",
                true
            );


    if (error) {
        throw error;
    }


    const groups = {

        15:
            allGifts.filter(
                gift =>
                    Number(gift.price) === 15
            ),

        18:
            allGifts.filter(
                gift =>
                    Number(gift.price) === 18
            ),

        22:
            allGifts.filter(
                gift =>
                    Number(gift.price) === 22
            ),

        33:
            allGifts.filter(
                gift =>
                    Number(gift.price) === 33
            )

    };


    function randomItems(
        array,
        count
    ) {

        const copy =
            [...array];


        for (
            let i = copy.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() *
                    (i + 1)
                );


            [
                copy[i],
                copy[j]
            ] =
            [
                copy[j],
                copy[i]
            ];

        }


        return copy.slice(
            0,
            Math.min(
                count,
                copy.length
            )
        );

    }


    const selected = [

        ...randomItems(
            groups[15],
            10
        ),

        ...randomItems(
            groups[18],
            5
        ),

        ...randomItems(
            groups[22],
            3
        ),

        ...randomItems(
            groups[33],
            2
        )

    ];


    const {
        error: deleteError
    } =
        await supabase
            .from("shop_gifts")
            .delete()
            .eq(
                "shop_id",
                1
            );


    if (deleteError) {
        throw deleteError;
    }


    if (selected.length > 0) {

        const rows =
            selected.map(
                gift => ({

                    shop_id:
                        1,

                    gift_id:
                        gift.id

                })
            );


        const {
            error: insertError
        } =
            await supabase
                .from("shop_gifts")
                .insert(rows);


        if (insertError) {
            throw insertError;
        }

    }


    const {
        error: stateError
    } =
        await supabase
            .from("shop_state")
            .update({

                updated_at:
                    new Date().toISOString()

            })
            .eq(
                "id",
                1
            );


    if (stateError) {
        throw stateError;
    }


    return selected;
}


/* =========================================================
   ПРОВЕРКА / АВТООБНОВЛЕНИЕ МАГАЗИНА
========================================================= */

async function ensureGiftShop() {

    const state =
        await getShopState();


    const updatedAt =
        new Date(
            state.updated_at
        ).getTime();


    const now =
        Date.now();


    const {
        data: currentShop,
        error: shopError
    } =
        await supabase
            .from("shop_gifts")
            .select("id")
            .eq(
                "shop_id",
                1
            );


    if (shopError) {
        throw shopError;
    }


    const shopIsEmpty =
        !currentShop ||
        currentShop.length === 0;


    const timeToRefresh =
        !updatedAt ||
        now - updatedAt >=
        SHOP_REFRESH_MS;


    if (
        shopIsEmpty ||
        timeToRefresh
    ) {

        console.log(
            "🎁 Обновляем магазин подарков..."
        );


        return await refreshGiftShop();

    }


    return null;
}


/* =========================================================
   GET /api/gifts
========================================================= */

app.get(
    "/api/gifts",
    async (req, res) => {

        try {

            await ensureGiftShop();


            const {
                data,
                error
            } =
                await supabase
                    .from("shop_gifts")
                    .select(`
                        gift:gifts(
                            id,
                            name,
                            emoji,
                            price,
                            income,
                            active
                        )
                    `)
                    .eq(
                        "shop_id",
                        1
                    );


            if (error) {
                throw error;
            }


            const gifts =
                data
                    .map(
                        row =>
                            row.gift
                    )
                    .filter(Boolean)
                    .filter(
                        gift =>
                            gift.active
                    );


            const state =
                await getShopState();


            return res.json({

                ok: true,

                gifts,

                shop_updated_at:
                    state.updated_at,

                next_refresh_at:
                    new Date(
                        new Date(
                            state.updated_at
                        ).getTime() +
                        SHOP_REFRESH_MS
                    ).toISOString()

            });

        } catch (error) {

            console.error(
                "GIFTS ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   INVENTORY
========================================================= */

app.get(
    "/api/inventory",
    async (req, res) => {

        try {

            const telegramId =
                Number(
                    req.query.telegram_id
                );


            if (!telegramId) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан telegram_id"

                    });

            }


            const {
                data,
                error
            } =
                await supabase
                    .from("player_gifts")
                    .select(`
                        id,
                        telegram_id,
                        gift_id,
                        quantity,
                        purchased_at,
                        gift:gifts(
                            id,
                            name,
                            emoji,
                            price,
                            income
                        )
                    `)
                    .eq(
                        "telegram_id",
                        telegramId
                    )
                    .order(
                        "id",
                        {
                            ascending:
                                true
                        }
                    );


            if (error) {
                throw error;
            }


            const {
                data: purchases,
                error: purchasesError
            } =
                await supabase
                    .from("gift_purchases")
                    .select(`
                        id,
                        gift_id,
                        purchased_at
                    `)
                    .eq(
                        "telegram_id",
                        telegramId
                    )
                    .order(
                        "purchased_at",
                        {
                            ascending:
                                true
                        }
                    );


            if (purchasesError) {
                throw purchasesError;
            }


            const inventory =
                (data || []).map(
                    item => ({

                        id:
                            item.id,

                        telegram_id:
                            item.telegram_id,

                        gift_id:
                            item.gift_id,

                        quantity:
                            item.quantity,

                        purchased_at:
                            item.purchased_at,

                        gift:
                            item.gift,

                        purchases:
                            (purchases || [])
                                .filter(
                                    purchase =>
                                        Number(
                                            purchase.gift_id
                                        ) ===
                                        Number(
                                            item.gift_id
                                        )
                                )

                    })
                );


            return res.json({

                ok: true,

                inventory

            });

        } catch (error) {

            console.error(
                "INVENTORY ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   ПОКУПКА ПОДАРКА
========================================================= */

app.post(
    "/api/gifts/buy",
    async (req, res) => {

        try {

            const user =
                getTelegramUser(req);


            if (!user) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан Telegram user"

                    });

            }


            const giftId =
                Number(
                    req.body?.gift_id
                );


            if (!giftId) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан gift_id"

                    });

            }


            let quantity =
                Number(
                    req.body?.quantity
                );


            if (
                !Number.isFinite(
                    quantity
                ) ||
                quantity < 1
            ) {

                quantity = 1;

            }


            quantity =
                Math.floor(
                    quantity
                );


            if (quantity > 5) {
                quantity = 5;
            }


            const player =
                await getOrCreatePlayer(
                    user
                );


            const {
                data: shopGift,
                error: shopError
            } =
                await supabase
                    .from("shop_gifts")
                    .select(`
                        gift:gifts(
                            id,
                            name,
                            emoji,
                            price,
                            income,
                            active
                        )
                    `)
                    .eq(
                        "shop_id",
                        1
                    )
                    .eq(
                        "gift_id",
                        giftId
                    )
                    .maybeSingle();


            if (shopError) {
                throw shopError;
            }


            if (
                !shopGift ||
                !shopGift.gift ||
                !shopGift.gift.active
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Этого подарка сейчас нет в магазине"

                    });

            }


            const gift =
                shopGift.gift;


            const price =
                Number(
                    gift.price
                );


            const giftIncome =
                Number(
                    gift.income || 1
                );


            const {
                data: existingGift,
                error: existingError
            } =
                await supabase
                    .from("player_gifts")
                    .select("*")
                    .eq(
                        "telegram_id",
                        Number(user.id)
                    )
                    .eq(
                        "gift_id",
                        giftId
                    )
                    .maybeSingle();


            if (existingError) {
                throw existingError;
            }


            const currentQuantity =
                existingGift
                    ? Number(
                        existingGift.quantity
                    )
                    : 0;


            const remaining =
                5 -
                currentQuantity;


            if (
                remaining <= 0
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Можно купить максимум 5 одинаковых подарков"

                    });

            }


            if (
                quantity >
                remaining
            ) {

                quantity =
                    remaining;

            }


            const totalPrice =
                price *
                quantity;


            if (
                Number(player.balance) <
                totalPrice
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Недостаточно ⭐"

                    });

            }


            const newBalance =
                Number(
                    player.balance
                ) -
                totalPrice;


            const newIncome =
                Number(
                    player.income
                ) +
                (
                    giftIncome *
                    quantity
                );


            const {
                data: updatedPlayer,
                error: playerUpdateError
            } =
                await supabase
                    .from("players")
                    .update({

                        balance:
                            newBalance,

                        income:
                            newIncome

                    })
                    .eq(
                        "telegram_id",
                        Number(user.id)
                    )
                    .select("*")
                    .single();


            if (playerUpdateError) {
                throw playerUpdateError;
            }


            const purchaseRows =
                Array.from(
                    {
                        length:
                            quantity
                    },
                    () => ({

                        telegram_id:
                            Number(user.id),

                        gift_id:
                            giftId,

                        purchased_at:
                            new Date().toISOString()

                    })
                );


            const {
                data: purchases,
                error: purchaseError
            } =
                await supabase
                    .from("gift_purchases")
                    .insert(
                        purchaseRows
                    )
                    .select("*");


            if (purchaseError) {
                throw purchaseError;
            }


            const newQuantity =
                currentQuantity +
                quantity;


            if (existingGift) {

                const {
                    error: updateGiftError
                } =
                    await supabase
                        .from("player_gifts")
                        .update({

                            quantity:
                                newQuantity,

                            purchased_at:
                                new Date().toISOString()

                        })
                        .eq(
                            "telegram_id",
                            Number(user.id)
                        )
                        .eq(
                            "gift_id",
                            giftId
                        );


                if (updateGiftError) {
                    throw updateGiftError;
                }

            } else {

                const {
                    error: insertGiftError
                } =
                    await supabase
                        .from("player_gifts")
                        .insert({

                            telegram_id:
                                Number(user.id),

                            gift_id:
                                giftId,

                            quantity:
                                quantity,

                            purchased_at:
                                new Date().toISOString()

                        });


                if (insertGiftError) {
                    throw insertGiftError;
                }

            }


            return res.json({

                ok: true,

                player:
                    updatedPlayer,

                purchases:
                    purchases || [],

                gift,

                quantity,

                total_price:
                    totalPrice

            });

        } catch (error) {

            console.error(
                "BUY GIFT ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   ПРОДАЖА ПОДАРКА
========================================================= */

app.post(
    "/api/gifts/sell",
    async (req, res) => {

        try {

            const user =
                getTelegramUser(req);


            if (!user) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан Telegram user"

                    });

            }


            const purchaseId =
                Number(
                    req.body?.purchase_id
                );


            if (!purchaseId) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан purchase_id"

                    });

            }


            const {
                data: purchase,
                error: purchaseError
            } =
                await supabase
                    .from("gift_purchases")
                    .select(`
                        id,
                        telegram_id,
                        gift_id,
                        purchased_at,
                        gift:gifts(
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
                        Number(user.id)
                    )
                    .maybeSingle();


            if (purchaseError) {
                throw purchaseError;
            }


            if (!purchase) {

                return res
                    .status(404)
                    .json({

                        ok: false,

                        error:
                            "Покупка не найдена"

                    });

            }


            const purchasedAt =
                new Date(
                    purchase.purchased_at
                ).getTime();


            const sellAt =
                purchasedAt +
                GIFT_SELL_DELAY_MS;


            if (
                Date.now() <
                sellAt
            ) {

                const remaining =
                    sellAt -
                    Date.now();


                const hours =
                    Math.floor(
                        remaining /
                        3600000
                    );


                const minutes =
                    Math.floor(
                        (
                            remaining %
                            3600000
                        ) /
                        60000
                    );


                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            `Подарок пока нельзя продать. Осталось примерно ${hours} ч. ${minutes} мин.`

                    });

            }


            const gift =
                purchase.gift;


            const price =
                Number(
                    gift.price
                );


            const giftIncome =
                Number(
                    gift.income || 1
                );


            const {
                data: playerGift,
                error: playerGiftError
            } =
                await supabase
                    .from("player_gifts")
                    .select("*")
                    .eq(
                        "telegram_id",
                        Number(user.id)
                    )
                    .eq(
                        "gift_id",
                        Number(
                            purchase.gift_id
                        )
                    )
                    .maybeSingle();


            if (playerGiftError) {
                throw playerGiftError;
            }


            if (
                !playerGift ||
                Number(
                    playerGift.quantity
                ) <= 0
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Подарка нет в инвентаре"

                    });

            }


            const {
                error: deletePurchaseError
            } =
                await supabase
                    .from("gift_purchases")
                    .delete()
                    .eq(
                        "id",
                        purchaseId
                    )
                    .eq(
                        "telegram_id",
                        Number(user.id)
                    );


            if (deletePurchaseError) {
                throw deletePurchaseError;
            }


            const newQuantity =
                Number(
                    playerGift.quantity
                ) -
                1;


            if (
                newQuantity <= 0
            ) {

                const {
                    error
                } =
                    await supabase
                        .from("player_gifts")
                        .delete()
                        .eq(
                            "telegram_id",
                            Number(user.id)
                        )
                        .eq(
                            "gift_id",
                            Number(
                                purchase.gift_id
                            )
                        );


                if (error) {
                    throw error;
                }

            } else {

                const {
                    error
                } =
                    await supabase
                        .from("player_gifts")
                        .update({

                            quantity:
                                newQuantity

                        })
                        .eq(
                            "telegram_id",
                            Number(user.id)
                        )
                        .eq(
                            "gift_id",
                            Number(
                                purchase.gift_id
                            )
                        );


                if (error) {
                    throw error;
                }

            }


            const player =
                await getPlayerByTelegramId(
                    user.id
                );


            const newBalance =
                Number(
                    player.balance
                ) +
                price;


            const newIncome =
                Math.max(
                    0,
                    Number(
                        player.income
                    ) -
                    giftIncome
                );


            const updatedPlayer =
                await updatePlayer(
                    user.id,
                    {

                        balance:
                            newBalance,

                        income:
                            newIncome

                    }
                );


            return res.json({

                ok: true,

                player:
                    updatedPlayer,

                refund:
                    price

            });

        } catch (error) {

            console.error(
                "SELL GIFT ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   СТАРЫЙ /api/buy
========================================================= */

app.post(
    "/api/buy",
    async (req, res) => {

        try {

            const user =
                getTelegramUser(req);


            if (!user) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан Telegram user"

                    });

            }


            const price =
                Number(
                    req.body?.price
                );


            if (!price) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не указана цена"

                    });

            }


            const player =
                await getOrCreatePlayer(
                    user
                );


            if (
                Number(player.balance) <
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


            const updatedPlayer =
                await updatePlayer(
                    user.id,
                    {

                        balance:
                            Number(
                                player.balance
                            ) -
                            price,

                        income:
                            Number(
                                player.income
                            ) +
                            1

                    }
                );


            return res.json({

                ok: true,

                player:
                    updatedPlayer

            });

        } catch (error) {

            console.error(
                "OLD BUY ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   WEEKLY BONUS
========================================================= */

app.post(
    "/api/collect",
    async (req, res) => {

        try {

            const user =
                getTelegramUser(req);


            if (!user) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан Telegram user"

                    });

            }


            const player =
                await getOrCreatePlayer(
                    user
                );


            const now =
                Date.now();


            if (
                player.bonus_claimed_at
            ) {

                const lastClaim =
                    new Date(
                        player.bonus_claimed_at
                    ).getTime();


                const week =
                    7 *
                    24 *
                    60 *
                    60 *
                    1000;


                if (
                    now - lastClaim <
                    week
                ) {

                    const remaining =
                        week -
                        (
                            now -
                            lastClaim
                        );


                    const days =
                        Math.ceil(
                            remaining /
                            (
                                24 *
                                60 *
                                60 *
                                1000
                            )
                        );


                    return res
                        .status(400)
                        .json({

                            ok: false,

                            error:
                                `Бонус будет доступен через ${days} дн.`

                        });

                }

            }


            const updatedPlayer =
                await updatePlayer(
                    user.id,
                    {

                        balance:
                            Number(
                                player.balance
                            ) +
                            1000,

                        bonus_claimed_at:
                            new Date().toISOString()

                    }
                );


            return res.json({

                ok: true,

                player:
                    updatedPlayer,

                reward:
                    1000

            });

        } catch (error) {

            console.error(
                "COLLECT ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   РУЛЕТКА
========================================================= */

const ROULETTE_VALUES = [

    1.0,
    1.1,
    1.2,
    1.3,
    1.4,
    1.5,
    1.6,
    1.7,
    1.8,
    1.9,
    2.0

];


function createRouletteSignature(
    telegramId,
    multiplier,
    issuedAt
) {

    const text =
        [
            telegramId,
            multiplier.toFixed(1),
            issuedAt
        ].join(":");


    return crypto
        .createHmac(
            "sha256",
            BOT_TOKEN
        )
        .update(text)
        .digest("hex");

}


/* =========================================================
   ROULETTE SPIN
========================================================= */

app.post(
    "/api/roulette/spin",
    async (req, res) => {

        try {

            const user =
                getTelegramUser(req);


            if (!user) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан Telegram user"

                    });

            }


            const multiplier =
                ROULETTE_VALUES[
                    Math.floor(
                        Math.random() *
                        ROULETTE_VALUES.length
                    )
                ];


            const issuedAt =
                Date.now();


            const signature =
                createRouletteSignature(
                    Number(user.id),
                    multiplier,
                    issuedAt
                );


            return res.json({

                ok: true,

                multiplier,

                issuedAt,

                signature

            });

        } catch (error) {

            console.error(
                "ROULETTE SPIN ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   ROULETTE CLAIM
========================================================= */

app.post(
    "/api/roulette/claim",
    async (req, res) => {

        try {

            const user =
                getTelegramUser(req);


            if (!user) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Не передан Telegram user"

                    });

            }


            const multiplier =
                Number(
                    req.body?.multiplier
                );


            const issuedAt =
                Number(
                    req.body?.issuedAt
                );


            const signature =
                req.body?.signature;


            if (
                !multiplier ||
                !issuedAt ||
                !signature
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Недостаточно данных рулетки"

                    });

            }


            if (
                !ROULETTE_VALUES.includes(
                    multiplier
                )
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Неверный множитель"

                    });

            }


            if (
                Date.now() -
                issuedAt >
                2 * 60 * 1000
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Результат рулетки устарел"

                    });

            }


            const expectedSignature =
                createRouletteSignature(
                    Number(user.id),
                    multiplier,
                    issuedAt
                );


            if (
                signature !==
                expectedSignature
            ) {

                return res
                    .status(403)
                    .json({

                        ok: false,

                        error:
                            "Неверная подпись рулетки"

                    });

            }


            const player =
                await getOrCreatePlayer(
                    user
                );


            const expiresAt =
                new Date(
                    Date.now() +
                    ROULETTE_DURATION_MS
                ).toISOString();


            const updatedPlayer =
                await updatePlayer(
                    user.id,
                    {

                        economy_multiplier:
                            multiplier,

                        economy_expires_at:
                            expiresAt

                    }
                );


            return res.json({

                ok: true,

                player:
                    updatedPlayer,

                multiplier,

                expires_at:
                    expiresAt

            });

        } catch (error) {

            console.error(
                "ROULETTE CLAIM ERROR:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        error.message

                });

        }

    }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            ok: true,

            service:
                "RaneGame",

            time:
                new Date().toISOString()

        });

    }
);


/* =========================================================
   TELEGRAM BOT
========================================================= */

let telegramOffset = 0;


/* =========================================================
   TELEGRAM API
========================================================= */

async function telegramRequest(
    method,
    body
) {

    const response =
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify(body)

            }
        );


    const data =
        await response.json();


    if (!data.ok) {

        throw new Error(
            data.description ||
            "Telegram API error"
        );

    }


    return data;
}


/* =========================================================
   REFERRAL
========================================================= */

const referralRewards = {

    2: 500,

    4: 1000,

    6: 4000,

    8: 7000,

    10: 1000

};


async function processReferral(
    inviterTelegramId,
    invitedUser
) {

    const inviterId =
        Number(
            inviterTelegramId
        );


    const invitedId =
        Number(
            invitedUser.id
        );


    if (
        !inviterId ||
        !invitedId
    ) {

        return;

    }


    if (
        inviterId ===
        invitedId
    ) {

        return;

    }


    const {
        data: existingReferral,
        error: existingError
    } =
        await supabase
            .from("referrals")
            .select("*")
            .eq(
                "invited_telegram_id",
                invitedId
            )
            .maybeSingle();


    if (existingError) {
        throw existingError;
    }


    if (existingReferral) {
        return;
    }


    const invitedPlayer =
        await getOrCreatePlayer(
            invitedUser
        );


    await updatePlayer(
        invitedId,
        {

            balance:
                Number(
                    invitedPlayer.balance
                ) +
                100

        }
    );


    const {
        count,
        error: countError
    } =
        await supabase
            .from("referrals")
            .select(
                "id",
                {

                    count:
                        "exact",

                    head:
                        true

                }
            )
            .eq(
                "inviter_telegram_id",
                inviterId
            );


    if (countError) {
        throw countError;
    }


    const inviteNumber =
        Number(
            count || 0
        ) +
        1;


    const {
        error: referralInsertError
    } =
        await supabase
            .from("referrals")
            .insert({

                inviter_telegram_id:
                    inviterId,

                invited_telegram_id:
                    invitedId,

                reward_paid:
                    true

            });


    if (referralInsertError) {
        throw referralInsertError;
    }


    const reward =
        referralRewards[
            inviteNumber
        ] || 0;


    if (
        reward > 0
    ) {

        const inviter =
            await getPlayerByTelegramId(
                inviterId
            );


        await updatePlayer(
            inviterId,
            {

                balance:
                    Number(
                        inviter.balance
                    ) +
                    reward

            }
        );

    }

}


/* =========================================================
   TELEGRAM START
========================================================= */

async function handleTelegramUpdate(
    update
) {

    const message =
        update.message;


    if (!message) {
        return;
    }


    const from =
        message.from;


    if (!from) {
        return;
    }


    const text =
        message.text ||
        "";


    if (
        !text.startsWith(
            "/start"
        )
    ) {

        return;

    }


    const parts =
        text
            .trim()
            .split(
                /\s+/
            );


    const startParam =
        parts[1] ||
        "";


    const player =
        await getOrCreatePlayer(
            from
        );


    if (
        startParam.startsWith(
            "ref_"
        )
    ) {

        const inviterId =
            Number(
                startParam.substring(
                    4
                )
            );


        if (
            inviterId &&
            inviterId !==
            Number(from.id)
        ) {

            try {

                await processReferral(
                    inviterId,
                    from
                );

            } catch (error) {

                console.error(
                    "REFERRAL ERROR:",
                    error
                );

            }

        }

    }


    await telegramRequest(
        "sendMessage",
        {

            chat_id:
                message.chat.id,

            text:
                "🎮 RaneGame готов!",

            reply_markup: {

                inline_keyboard: [

                    [

                        {

                            text:
                                "🎮 Открыть RaneGame",

                            web_app: {

                                url:
                                    "https://ranegame.onrender.com"

                            }

                        }

                    ]

                ]

            }

        }
    );

}


/* =========================================================
   TELEGRAM POLLING
========================================================= */

async function telegramPolling() {

    if (!BOT_TOKEN) {

        console.log(
            "⚠️ BOT_TOKEN не задан — Telegram polling отключён"
        );

        return;

    }


    try {

        const data =
            await telegramRequest(
                "getUpdates",
                {

                    offset:
                        telegramOffset,

                    timeout:
                        25

                }
            );


        for (
            const update
            of data.result
        ) {

            telegramOffset =
                update.update_id +
                1;


            try {

                await handleTelegramUpdate(
                    update
                );

            } catch (error) {

                console.error(
                    "TELEGRAM UPDATE ERROR:",
                    error
                );

            }

        }

    } catch (error) {

        console.error(
            "TELEGRAM POLLING ERROR:",
            error.message
        );

    }


    setTimeout(
        telegramPolling,
        1000
    );

}


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 RaneGame запущен на порту ${PORT}`
        );

        console.log(
            "🎁 Магазин подарков: OK"
        );

        console.log(
            "🎒 Инвентарь: OK"
        );

        console.log(
            "⏳ Продажа через 5 часов: OK"
        );

        console.log(
            "🔄 Обновление магазина каждые 3 часа: OK"
        );

        console.log(
            "🛠️ Admin Panel: OK"
        );

        telegramPolling();

    }
);
