from pathlib import Path

import pytest

from mosaic.analytics.clusters import (
    CreativeInput,
    cluster,
    content_distance,
    jaccard_distance,
    tag_distance,
)
from mosaic.synthetic.generator import SyntheticAccount


def test_distances() -> None:
    a = {"format": "UGC", "hook_type": "x", "angle": "y", "offer": "none", "proof_type": "none"}
    assert tag_distance(a, a) == 0
    assert tag_distance(a, {**a, "angle": "z"}) == pytest.approx(0.2)
    assert jaccard_distance("Buy now today", "buy NOW today!") == 0
    assert jaccard_distance("a b", "c d") == 1


def test_embeddings_drive_text_distance() -> None:
    t = {"format": "UGC"}
    near = [CreativeInput("a", t, "", 1, [1.0, 0.0]), CreativeInput("b", t, "", 1, [0.99, 0.05])]
    far = [CreativeInput("a", t, "", 1, [1.0, 0.0]), CreativeInput("b", t, "", 1, [0.0, 1.0])]
    assert len(cluster(near).clusters) == 1
    assert len(cluster(far).clusters) == 2


@pytest.mark.parametrize("seed", [1, 5, 42, 99])
def test_planted_near_duplicates_share_a_concept(seed: int) -> None:
    acc = SyntheticAccount(seed=seed)
    rows = acc.daily_metrics([s.ad.external_id for s in acc.ads], acc.start_date, acc.end_date)
    spend: dict[str, float] = {}
    for r in rows:
        spend[r.ad_external_id] = spend.get(r.ad_external_id, 0) + r.spend
    items = [
        CreativeInput(
            s.creative.external_id,
            s.tags,
            f"{s.creative.headline} {s.creative.primary_text}",
            spend[s.ad.external_id],
        )
        for s in acc.ads
    ]
    concepts = cluster(items)
    where = {cid: i for i, c in enumerate(concepts.clusters) for cid in c.creative_ids}
    for p in (p for p in acc.patterns if p.kind == "near_duplicate"):
        a, b = p.creative_external_ids
        assert where[a] == where[b]
    assert 1 <= concepts.diversity <= len(concepts.clusters)
    assert len(concepts.clusters) < len(items)
    assert abs(sum(c.spend_share for c in concepts.clusters) - 1) < 1e-3


def test_diversity_reflects_spend_concentration() -> None:
    t1, t2 = {"format": "UGC", "hook_type": "a"}, {"format": "demo", "hook_type": "b"}
    even = cluster([CreativeInput("a", t1, "one", 100), CreativeInput("b", t2, "two", 100)])
    skew = cluster([CreativeInput("a", t1, "one", 1990), CreativeInput("b", t2, "two", 10)])
    assert even.diversity == pytest.approx(2, abs=0.01)
    assert 1 <= skew.diversity < 1.1


class FakeEmbedder:
    model = "fake-embed"

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(texts)
        return [[float(len(t)), 1.0] for t in texts]


def test_embed_scripts_skips_unchanged_text() -> None:
    from mosaic.perception.embed import embed_scripts, load_embeddings
    from mosaic.store import MemoryStore

    store = MemoryStore()
    store.insert(
        "creatives", {"id": "c1", "workspace_id": "ws", "headline": "H", "primary_text": "Buy it"}
    )
    store.insert(
        "creatives", {"id": "c2", "workspace_id": "ws", "headline": None, "primary_text": None}
    )
    store.insert("scenes", {"creative_id": "c1", "idx": 0, "transcript": "Tired?"})
    fake = FakeEmbedder()
    first = embed_scripts(store, fake, "ws")
    assert (first.embedded, first.skipped_empty) == (1, 1)
    assert fake.calls == [["H\nBuy it\nTired?"]]
    again = embed_scripts(store, fake, "ws")
    assert (again.embedded, again.skipped_unchanged) == (0, 1) and len(fake.calls) == 1
    store.update("creatives", {"primary_text": "Buy it now"}, id="c1")
    assert embed_scripts(store, fake, "ws").embedded == 1
    assert len(store.tables["creative_embeddings"]) == 1  # replaced, not duplicated
    assert load_embeddings(store, ["c1"])["c1"] == [float(len("H\nBuy it now\nTired?")), 1.0]


class FakeImageEmbedder:
    model = "fake-image"

    def __init__(self) -> None:
        self.calls: list[list[bytes]] = []

    def embed_images(self, files: list[Path]) -> list[list[float]]:
        self.calls.append([f.read_bytes() for f in files])
        return [[1.0, 0.0] if f.read_bytes() == b"red" else [0.0, 1.0] for f in files]


def test_embed_visuals_averages_keyframes_and_skips_unchanged(tmp_path: Path) -> None:
    from mosaic.media import MemoryStorage
    from mosaic.perception.embed import MAX_FRAMES, embed_visuals, load_embeddings
    from mosaic.store import MemoryStore

    store, storage = MemoryStore(), MemoryStorage()
    for name, data in (("red.jpg", b"red"), ("blue.jpg", b"blue")):
        (tmp_path / name).write_bytes(data)
        storage.upload(name, tmp_path / name, "image/jpeg")
    common = {"workspace_id": "ws", "perception_status": "done", "content_hash": "h"}
    store.insert("creatives", {"id": "v", "type": "video", "storage_path": "v.mp4", **common})
    store.insert("creatives", {"id": "s", "type": "image", "storage_path": "red.jpg", **common})
    store.insert(
        "creatives",
        {
            "id": "p",
            "type": "image",
            "storage_path": "red.jpg",
            "workspace_id": "ws",
            "perception_status": "pending",
        },
    )
    store.insert("scenes", {"creative_id": "v", "idx": 0, "keyframe_path": "red.jpg"})
    store.insert("scenes", {"creative_id": "v", "idx": 1, "keyframe_path": "blue.jpg"})
    fake = FakeImageEmbedder()
    first = embed_visuals(store, storage, fake, "ws")
    assert (first.embedded, first.skipped_empty) == (2, 1)  # the pending creative waits
    vecs = load_embeddings(store, ["v", "s"], kind="visual")
    assert vecs["v"] == pytest.approx([2**-0.5, 2**-0.5])  # mean of red and blue, unit length
    assert vecs["s"] == [1.0, 0.0]
    assert embed_visuals(store, storage, fake, "ws").embedded == 0
    for i in range(2, 2 * MAX_FRAMES):
        store.insert("scenes", {"creative_id": "v", "idx": i, "keyframe_path": "red.jpg"})
    assert embed_visuals(store, storage, fake, "ws").embedded == 1  # new keyframes
    assert len(fake.calls[-1]) == MAX_FRAMES


def test_visual_embeddings_join_or_replace_text() -> None:
    t = {"format": "static image"}
    # Statics with no copy: compared on the image alone.
    same = [
        CreativeInput("a", t, "", 1, visual=[1.0, 0.0]),
        CreativeInput("b", t, "", 1, visual=[0.99, 0.05]),
    ]
    diff = [
        CreativeInput("a", t, "", 1, visual=[1.0, 0.0]),
        CreativeInput("b", t, "", 1, visual=[0.0, 1.0]),
    ]
    assert len(cluster(same).clusters) == 1
    assert len(cluster(diff).clusters) == 2
    # Same script but different visuals: the two halves average, so they split.
    both = [
        CreativeInput("a", t, "", 1, [1.0, 0.0], [1.0, 0.0]),
        CreativeInput("b", t, "", 1, [1.0, 0.0], [0.0, 1.0]),
    ]
    assert content_distance(*both) == pytest.approx(0.5)
    # Without visuals on both sides, content distance is the text distance as before.
    one = [
        CreativeInput("a", t, "buy now", 1, visual=[1.0, 0.0]),
        CreativeInput("b", t, "buy now", 1),
    ]
    assert content_distance(*one) == 0


def test_snapshots_carry_concepts_and_clusters_are_saved() -> None:
    from mosaic.analytics.run import latest_snapshot
    from mosaic.seed import seed
    from mosaic.store import MemoryStore

    store = MemoryStore()
    res = seed(store, "owner", seed=42)
    snap = latest_snapshot(store, res["workspace_id"], "all")
    assert (
        snap and snap.concepts and 1 < snap.concepts.diversity < len(snap.concepts.clusters) + 0.01
    )
    assert res["analysis"]["concepts"] == len(snap.concepts.clusters)
    members = store.tables["concept_cluster_members"]
    assert len(members) == 24 and len(store.tables["concept_clusters"]) == len(
        snap.concepts.clusters
    )
