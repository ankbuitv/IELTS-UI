/**
 * The shop.
 *
 * Coins are earned on the path and spent here on four things that make the path
 * easier rather than different: a streak freeze (insurance), a hint, a heart
 * refill, and double XP. Prices and effects come from `@shared/shop`, the same
 * module the Worker uses to charge — the shelf cannot drift from the till.
 *
 * The page also carries the soundboard. A learner is about to hear these
 * effects a few hundred times, so "turn the sound off" should be an informed
 * choice rather than a reflex; every effect can be auditioned here, and the
 * audition works even when sound is muted (that being the point of it).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { boostState, type ShopItemView, type ShopState } from '@shared/shop';
import { itemIcon } from './shop-icons';
import { Icon } from '../../components/Icon';
import { Badge, Button, Loading, Notice, useToast } from '../../components/ui';
import { Mascot } from '../../components/learn/Mascot';
import { useAsync } from '../../hooks/useAsync';
import { describeError } from '../../lib/api';
import { learnApi } from '../../lib/learn-api';
import { SFX_LIBRARY, sfx, type SfxName } from '../../lib/sfx';

export function ShopPage() {
  const toast = useToast();
  const shop = useAsync<ShopState>(() => learnApi.shop(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(() => sfx.isEnabled());
  const [clock, setClock] = useState(0);

  // The boost countdown is a label in minutes; a tick every 30 s keeps it honest.
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  void clock;

  const buy = async (item: ShopItemView) => {
    setBusyKey(item.key);
    try {
      const response = await learnApi.buy(item.key, 1);
      shop.setData(response.state);
      sfx.play('buy');
      toast.push(`${item.name} bought for ${response.spent} coins.`, 'success');
    } catch (error) {
      sfx.play('error');
      toast.push(describeError(error), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const switchOn = async (item: ShopItemView) => {
    setBusyKey(item.key);
    try {
      const response = await learnApi.useItem(item.key);
      shop.setData(response.state);
      if (response.applied) {
        sfx.play(item.key === 'xp_boost' ? 'boost' : 'select');
        toast.push(response.detail, 'success');
      } else {
        sfx.play('error');
        toast.push(response.detail, 'warning');
      }
    } catch (error) {
      sfx.play('error');
      toast.push(describeError(error), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  if (shop.loading && !shop.data) return <Loading label="Opening the shop…" />;
  if (shop.error && !shop.data) {
    return (
      <Notice tone="danger" title="The shop could not be opened">
        {shop.error}
      </Notice>
    );
  }
  if (!shop.data) return null;

  const state = shop.data;
  const boost = boostState(state.xpBoostUntil, new Date());

  return (
    <div className="shop">
      <header className="shop__hero">
        <Mascot mood="wave" size={132} />
        <div className="shop__hero-text">
          <p className="shop__kicker">Learn shop</p>
          <h1>Spend what you earned</h1>
          <p>
            Coins come from lessons, reviews, daily quests and the first visit of the day. Nothing here can be bought with money — it is all
            paid for with work you have already done.
          </p>
          <ul className="shop__earn">
            <li>{state.earning.perLesson}</li>
            <li>{state.earning.perReview}</li>
            <li>+{state.earning.dailyBonus} coins the first time you study on any day.</li>
          </ul>
        </div>
        <div className="shop__balance" aria-label="Your coins">
          <Icon name="coin" size={30} />
          <b>{state.coins.toLocaleString('en')}</b>
          <span>coins</span>
          {boost.active ? (
            <em className="shop__boost">
              ⚡ Double XP · {boost.minutesLeft}m left
            </em>
          ) : (
            <Link className="shop__boost shop__boost--off" to="/learn">
              Earn more on the path
            </Link>
          )}
        </div>
      </header>

      <section className="shop__grid" aria-label="Items">
        {state.items.map((item) => (
          <article key={item.key} className={`shop-card shop-card--${item.tone}`}>
            <header className="shop-card__head">
              <span className="shop-card__icon" aria-hidden="true">
                <Icon name={itemIcon(item.key)} size={22} />
              </span>
              <div>
                <h2>{item.name}</h2>
                <p className="shop-card__tagline">{item.tagline}</p>
              </div>
            </header>
            <p className="shop-card__detail">{item.detail}</p>
            <div className="shop-card__meta">
              <Badge tone={item.owned > 0 ? 'success' : 'neutral'}>
                {item.owned > 0 ? `${item.owned} in your bag` : 'Not owned'}
              </Badge>
              {item.owned >= item.maxOwned ? <Badge tone="warning">Max</Badge> : null}
            </div>
            <div className="shop-card__actions">
              <span className="shop-card__price">
                <Icon name="coin" size={15} /> {item.price}
              </span>
              <Button
                variant={item.affordable ? 'primary' : 'default'}
                size="sm"
                disabled={!item.canBuyMore || !item.affordable}
                loading={busyKey === item.key}
                onClick={() => void buy(item)}
              >
                {!item.canBuyMore ? 'At the cap' : item.affordable ? 'Buy' : `Need ${item.price - state.coins} more`}
              </Button>
            </div>
            {item.manual && item.owned > 0 ? (
              <Button size="sm" variant="secondary" block loading={busyKey === item.key} onClick={() => void switchOn(item)}>
                <Icon name={item.key === 'xp_boost' ? 'bolt' : 'play'} size={13} />
                {item.key === 'xp_boost' ? 'Switch on now' : 'Use now'}
              </Button>
            ) : null}
            {item.cosmetic ? <Link className="shop-card__profile-link" to="/learn/profile">Equip on your profile <Icon name="arrowRight" size={13} /></Link> : null}
          </article>
        ))}
      </section>

      <section className="shop__extras">
        <article className="card shop-sounds">
          <header className="shop-sounds__head">
            <div>
              <h2>Soundboard</h2>
              <p className="muted small">
                One effect for every event — {SFX_LIBRARY.length} sounds, all made by the browser. Press any of them to hear it; auditions play
                even while the lesson is muted.
              </p>
            </div>
            <Button
              size="sm"
              variant={soundOn ? 'default' : 'primary'}
              aria-pressed={soundOn}
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                sfx.setEnabled(next);
                if (next) sfx.preview('select');
              }}
            >
              <Icon name="volume" size={14} />
              {soundOn ? 'Sound on' : 'Sound off'}
            </Button>
          </header>
          <div className="shop-sounds__grid">
            {SFX_LIBRARY.map((sound) => (
              <button
                key={sound.name}
                type="button"
                className="sound-chip"
                onClick={() => {
                  sfx.preview(sound.name as SfxName);
                }}
              >
                <Icon name="play" size={12} />
                <b>{sound.label}</b>
                <span>{sound.when}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="card shop__inventory">
          <h2>Your bag</h2>
          {Object.entries(state.inventory).length === 0 ? (
            <p className="muted small">Nothing yet. Buy something and it appears here, ready for the next lesson.</p>
          ) : (
            <ul>
              {Object.entries(state.inventory).map(([key, quantity]) => (
                <li key={key}>
                  <Icon name={itemIcon(key as ShopItemView['key'])} size={15} />
                  <b>{state.items.find((item) => item.key === key)?.name ?? key}</b>
                  <span>×{quantity}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted tiny">
            A streak freeze is spent by itself when you miss a day. A heart refill and a hint are spent inside a lesson. Double XP runs from
            the moment you switch it on.
          </p>
          <Link className="learn-card__link" to="/learn">
            Back to the path <Icon name="arrowRight" size={13} />
          </Link>
        </article>
      </section>

    </div>
  );
}
