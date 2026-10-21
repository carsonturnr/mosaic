import shutil
import subprocess
from pathlib import Path

import pytest

HAS_FFMPEG = shutil.which("ffmpeg") is not None


@pytest.fixture(scope="session")
def test_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """9-second video with hard cuts at 2 s and 5 s (red, green, blue), 24 fps."""
    if not HAS_FFMPEG:
        pytest.skip("ffmpeg not installed")
    out = tmp_path_factory.mktemp("media") / "cuts.mp4"
    filt = (
        "color=c=red:s=320x240:d=2:r=24[a];"
        "color=c=green:s=320x240:d=3:r=24[b];"
        "color=c=blue:s=320x240:d=4:r=24[c];"
        "[a][b][c]concat=n=3:v=1:a=0"
    )
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-filter_complex", filt, "-pix_fmt", "yuv420p", str(out)],
        check=True,
        capture_output=True,
        timeout=120,
    )
    return out
