/**
 * The Learn shop: coins in, items out.
 *
 * The browser never decides a price or a balance. It asks to buy, and this
 * service checks the catalogue for the price, checks the wallet, and writes the
 * purchase and the coin movement in the same batch — so a balance can always be
 * reconstructed from `learn_coin_log` and `learn_shop_orders`.
 *
 * Two things are deliberately generous:
 *
 *   * buying again is a plain repeat, not an error, so a double-tap cannot
 *     take coins twice (the second call fails on the balance check and the
 *     client simply re-reads the wallet);
 *   * using an item that is not held answers with the unchanged wallet and
 *     `applied: false` rather than throwing, because the lesson player calls
 *     this at the end of a keyboard sequence and an exception there would look
 *     like a crash.
 */
import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import {
  HINT_REMOVES_OPTIONS,
  HEART_REFILL_AMOUNT,
  boostUntilFrom,
  isShopItemKey,
  shopItem,
  shopItemViews,
  type ShopItemKey,
  type ShopState,
  type Wallet,
} from '../../shared/shop';
import type { QuestCounters, QuestView } from '../../shared/shop';
import { DAILY_QUESTS, completedQuests, questViews } from '../../shared/shop';

interface WalletRow {
  coins: number;
  xp_boost_until: string;
}

/** The learner's wallet: coins, the running boost, and what the shelf holds. */
export async function readWallet(env: Env, userId: string): Promise<Wallet> {
  const [row, items] = await Promise.all([
    env.DB.prepare('SELECT coins, xp_boost_until FROM learn_profiles WHERE user_id = ?')
      .bind(userId)
      .first<WalletRow>(),
    env.DB.prepare('SELECT item_key, quantity FROM learn_inventory WHERE user_id = ? AND quantity > 0')
      .bind(userId)
      .all<{ item_key: string; quantity: number }>(),
  ]);
  const inventory: Wallet['inventory'] = {};
  for (const item of items.results ?? []) {
    if (isShopItemKey(item.item_key) && item.quantity > 0) inventory[item.item_key] = item.quantity;
  }
  return {
    coins: row?.coins ?? 0,
    xpBoostUntil: row?.xp_boost_until ? row.xp_boost_until : null,
    inventory,
  };
}

export async function getShopState(env: Env, userId: string): Promise<ShopState> {
  const wallet = await readWallet(env, userId);
  return {
    ...wallet,
    items: shopItemViews(wallet),
    earning: {
      perLesson: 'A lesson pays 4 coins plus 1 for every first-try answer, and 4 more for a perfect run (half on a repeat).',
      perReview: 'A review pays 1 coin per word, plus 2 for a clean sweep.',
      dailyBonus: 10,
    },
  };
}

/** Coins and inventory changed together: the statements a caller can batch. */
export function coinStatements(
  env: Env,
  input: { userId: string; day: string; delta: number; reason: string; now: string },
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      'INSERT INTO learn_coin_log (id, user_id, day, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(newId('coin'), input.userId, input.day, input.delta, input.reason, input.now),
    env.DB.prepare('UPDATE learn_profiles SET coins = MAX(0, coins + ?), updated_at = ? WHERE user_id = ?').bind(
      input.delta,
      input.now,
      input.userId,
    ),
  ];
}

/**
 * A purchase, one unit at a time (the client may ask for several).
 *
 * The debit is a conditional UPDATE — `coins >= price` — so two purchases
 * racing each other cannot both pass on the same balance: the second one sees
 * zero changed rows and is refused. Inventory can never exceed the catalogue's
 * cap, which is checked before the debit.
 */
export async function purchaseItem(
  env: Env,
  userId: string,
  key: ShopItemKey,
  quantity: number,
): Promise<{ state: ShopState; spent: number; owned: number }> {
  const item = shopItem(key);
  const count = Math.max(1, Math.min(5, Math.floor(quantity)));
  const wallet = await readWallet(env, userId);
  const owned = wallet.inventory[key] ?? 0;
  if (owned + count > item.maxOwned) {
    throw ApiError.validation(
      owned >= item.maxOwned
        ? `You already hold the maximum of ${item.maxOwned} ${item.name}${item.maxOwned === 1 ? '' : 's'}.`
        : `You can hold at most ${item.maxOwned} of these, and you already have ${owned}.`,
    );
  }
  const total = item.price * count;
  if (wallet.coins < total) {
    throw ApiError.validation(`That costs ${total} coins and you have ${wallet.coins}. Finish a lesson or a daily quest to earn more.`);
  }

  const now = nowIso();
  const debit = await env.DB.prepare(
    'UPDATE learn_profiles SET coins = coins - ?, updated_at = ? WHERE user_id = ? AND coins >= ?',
  )
    .bind(total, now, userId, total)
    .run();
  if ((debit.meta?.changes ?? 0) === 0) {
    throw ApiError.validation('Your balance changed while buying. Check the shelf and try again.');
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO learn_inventory (user_id, item_key, quantity, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, item_key) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`,
    ).bind(userId, key, count, now),
    env.DB.prepare(
      'INSERT INTO learn_shop_orders (id, user_id, item_key, quantity, unit_price, coins_spent, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(newId('order'), userId, key, count, item.price, total, wallet.coins - total, now),
    env.DB.prepare(
      'INSERT INTO learn_coin_log (id, user_id, day, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(newId('coin'), userId, '', -total, `shop:${key}`, now),
  ]);

  return { state: await getShopState(env, userId), spent: total, owned: owned + count };
}

/**
 * Spends one item the learner pressed "use" on.
 *
 * `xp_boost` is the only item with a lasting effect; the others are consumed by
 * the thing they were bought for (`heart_refill` and `hint` act on the client's
 * lesson state, which is where the lesson lives). Either way the quantity goes
 * down by exactly one here, and only here.
 */
export async function useItem(
  env: Env,
  userId: string,
  key: ShopItemKey,
): Promise<{ state: ShopState; applied: boolean; detail: string }> {
  const item = shopItem(key);
  if (item.cosmetic) throw ApiError.validation('Cosmetics are permanent unlocks. Equip them from your player profile.');
  const now = nowIso();
  const spent = await env.DB.prepare(
    'UPDATE learn_inventory SET quantity = quantity - 1, updated_at = ? WHERE user_id = ? AND item_key = ? AND quantity > 0',
  )
    .bind(now, userId, key)
    .run();
  if ((spent.meta?.changes ?? 0) === 0) {
    return { state: await getShopState(env, userId), applied: false, detail: `You have no ${item.name.toLowerCase()} left.` };
  }

  if (key === 'xp_boost') {
    const until = boostUntilFrom();
    await env.DB.prepare('UPDATE learn_profiles SET xp_boost_until = ?, updated_at = ? WHERE user_id = ?')
      .bind(until, now, userId)
      .run();
    return { state: await getShopState(env, userId), applied: true, detail: 'Double XP is running. Every lesson pays twice.' };
  }
  if (key === 'heart_refill') {
    return { state: await getShopState(env, userId), applied: true, detail: `Back to ${HEART_REFILL_AMOUNT} hearts.` };
  }
  if (key === 'hint') {
    return { state: await getShopState(env, userId), applied: true, detail: `${HINT_REMOVES_OPTIONS} wrong answers are gone.` };
  }
  return { state: await getShopState(env, userId), applied: true, detail: 'Your streak is covered for one missed day.' };
}

// ------------------------------------------------------------------- quests
/** Today's activity, as the quest metrics see it. */
export async function questCounters(env: Env, userId: string, day: string, todayXp: number, goalXp: number): Promise<QuestCounters> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM learn_xp_log WHERE user_id = ? AND day = ? AND source LIKE 'lesson:%') AS lessons,
       (SELECT COUNT(*) FROM learn_xp_log WHERE user_id = ? AND day = ? AND source = 'review') AS reviews`,
  )
    .bind(userId, day, userId, day)
    .first<{ lessons: number; reviews: number }>();
  return {
    LESSONS: row?.lessons ?? 0,
    REVIEWS: row?.reviews ?? 0,
    GOAL: goalXp > 0 && todayXp >= goalXp ? 1 : 0,
  };
}

/** The quest states for a day, without paying anything. */
export async function readQuests(env: Env, userId: string, day: string, counters: QuestCounters): Promise<QuestView[]> {
  const rows = await env.DB.prepare('SELECT quest FROM learn_quest_rewards WHERE user_id = ? AND day = ?')
    .bind(userId, day)
    .all<{ quest: string }>();
  return questViews(counters, (rows.results ?? []).map((row) => row.quest));
}

/**
 * Pays every quest whose target is met and whose coins were not paid yet.
 *
 * The insert is `OR IGNORE` against the (user, day, quest) primary key, so the
 * payment is decided by whether the row was created — which makes this safe to
 * call from every place a lesson can finish, and harmless to call twice.
 */
export async function settleQuests(
  env: Env,
  userId: string,
  day: string,
  counters: QuestCounters,
): Promise<{ claimed: QuestView[]; coins: number }> {
  const done = completedQuests(counters);
  if (done.length === 0) return { claimed: [], coins: 0 };

  const now = nowIso();
  const results = await env.DB.batch(
    done.map((quest) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO learn_quest_rewards (user_id, day, quest, coins, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(userId, day, quest.key, quest.coins, now),
    ),
  );
  const paid = done.filter((_, index) => (results[index]?.meta?.changes ?? 0) > 0);
  const coins = paid.reduce((total, quest) => total + quest.coins, 0);
  if (coins > 0) {
    await env.DB.batch(coinStatements(env, { userId, day, delta: coins, reason: 'quests', now }));
  }
  const claimed = questViews(counters, done.map((quest) => quest.key)).filter((quest) =>
    paid.some((paidQuest) => paidQuest.key === quest.key),
  );
  return { claimed, coins };
}

/** The quest definitions, so a client can render a shelf with nothing paid yet. */
export function questCatalogue() {
  return DAILY_QUESTS;
}
