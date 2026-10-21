"""Scene detection and keyframes (docs/ARCHITECTURE.md §8).

PySceneDetect's ContentDetector with a 0.5 s minimum scene length, plus a forced
boundary at 3.0 s so the hook is always its own segment.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from scenedetect import ContentDetector, detect

HOOK_BOUNDARY_S = 3.0
MIN_SCENE_LEN_S = 0.5


@dataclass(frozen=True)
class SceneSpan:
    idx: int
    start_s: float
    end_s: float

    @property
    def mid_s(self) -> float:
        return (self.start_s + self.end_s) / 2


def detect_scenes(
    video: Path,
    *,
    duration_s: float | None = None,
    threshold: float = 27.0,
    min_scene_len_s: float = MIN_SCENE_LEN_S,
    hook_boundary_s: float = HOOK_BOUNDARY_S,
) -> list[SceneSpan]:
    scene_list = detect(
        str(video),
        ContentDetector(threshold=threshold, min_scene_len=1),
        show_progress=False,
    )
    if scene_list:
        cuts = [float(s.seconds) for s, _ in scene_list[1:]]
        end = float(scene_list[-1][1].seconds)
    else:
        cuts, end = [], float(duration_s or 0)
    if duration_s:
        end = max(end, float(duration_s))
    return split_with_hook(
        cuts, end, min_scene_len_s=min_scene_len_s, hook_boundary_s=hook_boundary_s
    )


def split_with_hook(
    cuts: list[float],
    end_s: float,
    *,
    min_scene_len_s: float = MIN_SCENE_LEN_S,
    hook_boundary_s: float = HOOK_BOUNDARY_S,
) -> list[SceneSpan]:
    """Pure helper: apply the minimum length and the forced hook boundary to cut points."""
    if end_s <= 0:
        return []
    bounds = sorted({round(c, 3) for c in cuts if 0 < c < end_s})
    # Drop cuts that would create a scene shorter than the minimum (keep the earlier cut).
    kept: list[float] = []
    for c in bounds:
        prev = kept[-1] if kept else 0.0
        if c - prev >= min_scene_len_s and end_s - c >= min_scene_len_s:
            kept.append(c)
    if 0 < hook_boundary_s < end_s and all(
        abs(c - hook_boundary_s) >= min_scene_len_s for c in kept
    ):
        kept.append(hook_boundary_s)
        kept.sort()
    edges = [0.0, *kept, round(end_s, 3)]
    return [SceneSpan(i, edges[i], edges[i + 1]) for i in range(len(edges) - 1)]


def extract_keyframe(video: Path, at_s: float, dest: Path, *, width: int = 640) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-ss",
            f"{at_s:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-vf",
            f"scale={width}:-2",
            "-q:v",
            "3",
            str(dest),
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )
    return dest


def keyframes_for(video: Path, scenes: list[SceneSpan], out_dir: Path) -> dict[int, Path]:
    return {
        s.idx: extract_keyframe(video, s.mid_s, out_dir / f"scene_{s.idx:03d}.jpg") for s in scenes
    }
