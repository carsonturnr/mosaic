import math

import numpy as np
import pytest

from mosaic.analytics.stats import (
    effective_number,
    fit_beta_prior,
    fit_gamma_prior,
    robust_z,
    shrink_cpa,
    shrink_rate,
    shrink_roas,
)


def test_beta_prior_recovers_mean_and_spread() -> None:
    rng = np.random.default_rng(0)
    true = rng.beta(20, 980, size=400)  # mean 2%
    n = rng.integers(2_000, 50_000, size=400)
    s = rng.binomial(n, true)
    prior = fit_beta_prior(list(s), list(n))
    assert prior is not None
    assert prior.mean == pytest.approx(0.02, rel=0.05)
    assert 400 < prior.alpha + prior.beta < 2_500  # true strength 1000, below the cap


def test_small_samples_are_pulled_to_the_prior_large_ones_are_not() -> None:
    prior = fit_beta_prior([200, 210, 190, 205], [10_000] * 4)
    assert prior is not None
    lucky = shrink_rate(3, 40, prior)  # 7.5% raw on 40 impressions
    proven = shrink_rate(300, 10_000, prior)  # 3% raw on 10k
    assert lucky.raw == pytest.approx(0.075)
    assert lucky.value is not None and proven.value is not None
    assert lucky.value < proven.value  # shrinkage reverses the naive ranking
    # the prior is capped at one typical ad, so a proven ad keeps much of its own signal
    assert 0.024 < proven.value < 0.03
    assert lucky.width is not None and proven.width is not None and lucky.width > proven.width
    assert lucky.low is not None and lucky.low <= lucky.value <= (lucky.high or 0)


def test_degenerate_inputs() -> None:
    assert fit_beta_prior([], []) is None
    assert fit_beta_prior([0, 0], [100, 100]) is None
    assert shrink_rate(0, 0, None).value is None
    assert shrink_rate(5, 100, None).value == pytest.approx(0.05)


def test_gamma_prior_and_cpa_roas() -> None:
    rng = np.random.default_rng(1)
    rate = rng.gamma(30, 1 / 1500, size=300)  # ~ 1 conversion per $50
    spend = rng.uniform(500, 20_000, size=300)
    conv = rng.poisson(rate * spend)
    prior = fit_gamma_prior(list(conv), list(spend))
    assert prior is not None and prior.mean == pytest.approx(1 / 50, rel=0.08)

    tiny = shrink_cpa(1, 10, prior)  # raw CPA $10 on $10 spend
    big = shrink_cpa(400, 20_000, prior)  # raw CPA $50, lots of data
    assert tiny.raw == 10 and tiny.value is not None and tiny.value > 30  # pulled toward ~$50
    assert big.value == pytest.approx(50, rel=0.05)
    assert big.low is not None and big.high is not None and big.low < big.value < big.high

    roas = shrink_roas(400, 20_000, 400 * 60, prior, account_aov=60)
    assert roas.value == pytest.approx(1.2, rel=0.05)
    assert shrink_roas(0, 0, 0, prior, 60).value is None


def test_robust_z_and_effective_number() -> None:
    z = robust_z([1, 1.1, 0.9, 1.0, 1.05, 5.0])
    assert z[-1] is not None and z[-1] > 2
    assert all(v is not None and abs(v) < 2 for v in z[:-1])
    assert robust_z([0, 0, 0]) == [None, None, None]
    # near-identical peers: a 3% gap is not an outlier
    assert all(z is not None and abs(z) < 2 for z in robust_z([1.0, 1.0, 1.0, 1.0, 1.03]))
    assert effective_number([0.25] * 4) == pytest.approx(4)
    assert effective_number([1.0, 0, 0]) == pytest.approx(1)
    assert 1 < effective_number([0.9, 0.05, 0.05]) < 2
    assert math.isclose(effective_number([]), 0.0)
