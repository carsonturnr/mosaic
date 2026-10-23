"""Empirical-Bayes shrinkage.

Rates (CTR, hook rate, hold rate, CVR) use a beta-binomial prior fit across the
account's ads by the method of moments. Conversions per dollar use a gamma-Poisson
prior the same way; CPA and ROAS are derived from it. Every estimate comes with a
90% credible interval, so a $40 ad with one lucky day cannot outrank a proven one.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats

LEVEL = 0.90
# Prior strength is capped so a handful of ads with identical rates can't produce an
# infinitely confident prior, and floored so the prior always does some work.
MIN_STRENGTH, MAX_STRENGTH = 2.0, 1e6


@dataclass(frozen=True)
class BetaPrior:
    alpha: float
    beta: float

    @property
    def mean(self) -> float:
        return self.alpha / (self.alpha + self.beta)


@dataclass(frozen=True)
class GammaPrior:
    shape: float  # pseudo-conversions
    rate: float  # pseudo-dollars

    @property
    def mean(self) -> float:
        return self.shape / self.rate


@dataclass(frozen=True)
class Estimate:
    value: float | None
    low: float | None
    high: float | None
    raw: float | None  # unshrunk observed value

    @property
    def width(self) -> float | None:
        return None if self.low is None or self.high is None else self.high - self.low


EMPTY = Estimate(None, None, None, None)


def fit_beta_prior(successes: list[float], trials: list[float]) -> BetaPrior | None:
    """Method-of-moments beta prior over per-ad rates, weighting ads by trials.

    Removes the binomial sampling variance from the observed spread so the prior
    reflects true between-ad variation, not noise.
    """
    s = np.asarray(successes, dtype=float)
    n = np.asarray(trials, dtype=float)
    keep = n > 0
    s, n = s[keep], n[keep]
    if len(n) == 0 or n.sum() == 0:
        return None
    p = s / n
    mu = float(s.sum() / n.sum())
    if mu <= 0 or mu >= 1:
        return None
    w = n / n.sum()
    var_obs = float(np.sum(w * (p - mu) ** 2))
    var_noise = float(np.sum(w * mu * (1 - mu) / n))
    var_true = max(var_obs - var_noise, 1e-12)
    strength = mu * (1 - mu) / var_true - 1
    # Never let the prior outweigh a typical ad: with few, similar ads the moment
    # estimate of between-ad variance collapses toward zero.
    cap = min(MAX_STRENGTH, max(MIN_STRENGTH, float(np.median(n))))
    strength = float(np.clip(strength, MIN_STRENGTH, cap))
    return BetaPrior(alpha=mu * strength, beta=(1 - mu) * strength)


def shrink_rate(successes: float, trials: float, prior: BetaPrior | None) -> Estimate:
    if trials <= 0:
        return EMPTY
    raw = successes / trials
    if prior is None:
        return Estimate(raw, None, None, raw)
    a, b = prior.alpha + successes, prior.beta + trials - successes
    lo, hi = stats.beta.ppf([(1 - LEVEL) / 2, (1 + LEVEL) / 2], a, b)
    return Estimate(a / (a + b), float(lo), float(hi), raw)


def fit_gamma_prior(conversions: list[float], spend: list[float]) -> GammaPrior | None:
    """Method-of-moments gamma prior over conversions-per-dollar across ads."""
    c = np.asarray(conversions, dtype=float)
    x = np.asarray(spend, dtype=float)
    keep = x > 0
    c, x = c[keep], x[keep]
    if len(x) == 0 or c.sum() <= 0:
        return None
    lam = float(c.sum() / x.sum())
    w = x / x.sum()
    var_obs = float(np.sum(w * (c / x - lam) ** 2))
    var_noise = float(np.sum(w * lam / x))  # Poisson noise of a rate per dollar
    var_true = max(var_obs - var_noise, 1e-18)
    shape = lam**2 / var_true
    # Same guard as the beta prior: at most one typical ad's worth of spend.
    cap = min(MAX_STRENGTH, max(MIN_STRENGTH, lam * float(np.median(x))))
    shape = float(np.clip(shape, MIN_STRENGTH, cap))
    return GammaPrior(shape=shape, rate=shape / lam)


def shrink_per_dollar(
    conversions: float, spend: float, prior: GammaPrior | None
) -> tuple[float, float, float] | None:
    """Posterior (mean, low, high) of conversions per dollar."""
    if spend <= 0:
        return None
    if prior is None:
        r = conversions / spend
        return (r, r, r) if conversions > 0 else None
    shape, rate = prior.shape + conversions, prior.rate + spend
    lo, hi = stats.gamma.ppf([(1 - LEVEL) / 2, (1 + LEVEL) / 2], shape, scale=1 / rate)
    return shape / rate, float(lo), float(hi)


def shrink_cpa(conversions: float, spend: float, prior: GammaPrior | None) -> Estimate:
    post = shrink_per_dollar(conversions, spend, prior)
    raw = spend / conversions if conversions > 0 else None
    if post is None:
        return Estimate(None, None, None, raw)
    mean, lo, hi = post
    # CPA = 1 / (conversions per dollar); the interval flips.
    return Estimate(1 / mean, 1 / hi if hi > 0 else None, 1 / lo if lo > 0 else None, raw)


def shrink_roas(
    conversions: float,
    spend: float,
    value: float,
    prior: GammaPrior | None,
    account_aov: float | None,
) -> Estimate:
    """ROAS = conversions-per-dollar x average order value.

    The conversion count carries the uncertainty; AOV is the ad's own when it has
    conversions, blended toward the account AOV with 5 pseudo-orders.
    """
    raw = value / spend if spend > 0 else None
    post = shrink_per_dollar(conversions, spend, prior)
    if post is None or account_aov is None:
        return Estimate(None, None, None, raw)
    k = 5.0
    aov = (value + k * account_aov) / (conversions + k)
    mean, lo, hi = post
    return Estimate(mean * aov, lo * aov, hi * aov, raw)


def robust_z(values: list[float], min_rel_spread: float = 0.10) -> list[float | None]:
    """(x - median) / scale, scale = max(1.4826 * MAD, min_rel_spread * |median|).

    The floor keeps near-identical peers from turning a 3% difference into z = 50:
    reaching |z| >= 2 always needs at least a 2 * min_rel_spread relative deviation.
    """
    x = np.asarray(values, dtype=float)
    if len(x) < 3:
        return [None] * len(x)
    med = float(np.median(x))
    scale = max(float(np.median(np.abs(x - med))) * 1.4826, min_rel_spread * abs(med))
    if scale <= 0:
        return [None] * len(x)
    return [float(v) for v in (x - med) / scale]


def effective_number(shares: list[float]) -> float:
    """exp(Shannon entropy) of shares: the spend-weighted count of distinct concepts."""
    p = np.asarray([s for s in shares if s > 0], dtype=float)
    if p.sum() <= 0:
        return 0.0
    p = p / p.sum()
    return float(np.exp(-np.sum(p * np.log(p))))
