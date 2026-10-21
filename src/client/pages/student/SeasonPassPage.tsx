/**
 * The season pass.
 *
 * Eight weeks, five tiers, rewards paid in coins and shop items. XP is the XP
 * already earned on the learning path, so the pass adds a finish line without
 * adding a second kind of homework. A claim is confirmed by the server before
 * the card changes, and a double-click cannot pay twice.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { seasonCountdown, type SeasonPassView } from '@shared/season';
import { shopItem } from '@shared/shop';
import { Icon } from '../../components/Icon';
import { Badge, Button, Card, Loading, Notice, ProgressBar } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { learnApi } from '../../lib/learn-api';
import { describeError } from '../../lib/api';

export function SeasonPassPage() {
  const pass = useAsync<SeasonPassView>(() => learnApi.season(), []);
  const [busyTier, setBusyTier] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = pass.data;
  const claim = async (tier: number) => {
    setBusyTier(tier);
    setError(null);
    setNotice(null);
    try {
      const result = await learnApi.claimSeasonTier(tier);
      pass.setData(result);
      const item = result.granted.item ? ` and ${shopItem(result.granted.item).name}` : '';
      setNotice(`Claimed ${result.granted.coins} coins${item}.`);
    } catch (claimError) {
      setError(describeError(claimError));
    } finally {
      setBusyTier(null);
    }
  };

  if (pass.loading && !data) return <Loading label="Opening the season pass…" />;
  if (pass.error && !data) {
    return (
      <Notice tone="danger" title="The season pass could not be loaded">
        {pass.error}
      </Notice>
    );
  }
  if (!data) return null;

  const nextTier = data.tiers.find((tier) => !tier.unlocked);
  const previousXp = data.tiers.filter((tier) => tier.unlocked).at(-1)?.xp ?? 0;
  const span = nextTier ? Math.max(1, nextTier.xp - previousXp) : 1;
  const progress = nextTier ? Math.min(100, Math.round(((data.xp - previousXp) / span) * 100)) : 100;

  return (
    <div className="stack season-page">
      <div className="page-head">
        <div>
          <p className="page-head__kicker">Season pass</p>
          <h1>{data.season.label}</h1>
          <p className="page-head__meta">
            {seasonCountdown(data.season)} · {data.season.startsOn} → {data.season.endsOn}. Season XP is the XP you already
            earn on the learning path.
          </p>
        </div>
        <Badge tone="accent">{data.xp.toLocaleString('en')} XP</Badge>
      </div>

      <Card
        title={nextTier ? `${nextTier.remaining} XP to ${nextTier.title}` : 'Every tier unlocked'}
        hint={nextTier ? `Tier ${nextTier.tier} of ${data.tiers.length}` : 'Claim anything you have not claimed yet.'}
        actions={<Link className="btn btn--sm btn--ghost" to="/learn">Earn XP <Icon name="arrowRight" size={13} /></Link>}
      >
        <ProgressBar value={nextTier ? Math.max(0, data.xp - previousXp) : 1} max={span} />
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>{progress}% of the way to the next reward.</p>
        <div className="season-stats">
          <div><span className="muted tiny">Season XP</span><b>{data.xp.toLocaleString('en')}</b></div>
          <div><span className="muted tiny">Tiers reached</span><b>{data.tier} / {data.tiers.length}</b></div>
          <div><span className="muted tiny">Days left</span><b>{data.season.daysLeft}</b></div>
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
      </Card>

      <div className="season-tiers">
        {data.tiers.map((tier) => (
          <section
            key={tier.tier}
            className={`season-tier${tier.unlocked ? ' is-unlocked' : ''}${tier.claimed ? ' is-claimed' : ''}`}
          >
            <header>
              <span className="season-tier__number">{tier.tier}</span>
              <div>
                <h2>{tier.title}</h2>
                <p className="tiny muted">{tier.blurb}</p>
              </div>
              {tier.claimed ? <Badge tone="success">Claimed</Badge> : tier.unlocked ? <Badge tone="warning">Ready</Badge> : <Badge tone="neutral">{tier.xp} XP</Badge>}
            </header>
            <ul className="season-tier__rewards">
              <li><Icon name="coin" size={14} /> {tier.coins} coins</li>
              {tier.item ? <li><Icon name="cart" size={14} /> {shopItem(tier.item).name}</li> : null}
            </ul>
            <div className="season-tier__foot">
              {tier.claimed ? (
                <span className="tiny muted">Paid out on {data.season.key}.</span>
              ) : (
                <Button
                  size="sm"
                  variant={tier.unlocked ? 'primary' : 'secondary'}
                  disabled={!tier.unlocked}
                  loading={busyTier === tier.tier}
                  onClick={() => void claim(tier.tier)}
                >
                  {tier.unlocked ? 'Claim reward' : `${tier.remaining} XP to go`}
                </Button>
              )}
            </div>
          </section>
        ))}
      </div>

      <Card title="How the season works" hint="No separate scoring, no extra homework.">
        <ul className="billing-plan__perks">
          <li><Icon name="check" size={13} /> Every lesson, review and daily goal adds XP to the pass.</li>
          <li><Icon name="check" size={13} /> Rewards are claimable the moment a tier is reached; they never expire mid-season.</li>
          <li><Icon name="check" size={13} /> At the end of the eight weeks the pass resets and the season rank is archived.</li>
          <li><Icon name="check" size={13} /> Coins go to the shop wallet; items land in your inventory.</li>
        </ul>
      </Card>
    </div>
  );
}
