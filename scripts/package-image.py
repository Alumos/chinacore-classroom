"""Package a static Linux binary as a docker-load compatible scratch image.

Useful on build hosts without a Docker daemon. The resulting runtime matches
the Dockerfile: embedded frontend, non-root UID 10001, writable /data volume,
port 18080 and the Go program's own healthcheck.
"""

import argparse
import hashlib
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import tarfile


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def add_file(archive, name, content, timestamp, mode=0o644, owner=0):
    info = tarfile.TarInfo(name)
    info.size = len(content)
    info.mtime = timestamp
    info.mode = mode
    info.uid = info.gid = owner
    archive.addfile(info, io.BytesIO(content))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--arch", choices=["amd64", "arm64"], default="amd64")
    parser.add_argument("--tag", default="chinacore-classroom:latest")
    args = parser.parse_args()
    binary = args.binary.read_bytes()
    expected_machine = {"amd64": 62, "arm64": 183}[args.arch]
    if binary[:4] != b"\x7fELF" or binary[4:6] != b"\x02\x01":
        parser.error("the input must be a 64-bit little-endian Linux ELF binary")
    if int.from_bytes(binary[18:20], "little") != expected_machine:
        parser.error("the binary architecture does not match --arch")
    # Scratch contains no dynamic loader. Refuse binaries with a PT_INTERP.
    phoff = int.from_bytes(binary[32:40], "little")
    phentsize = int.from_bytes(binary[54:56], "little")
    phnum = int.from_bytes(binary[56:58], "little")
    for index in range(phnum):
        entry = phoff + index * phentsize
        if int.from_bytes(binary[entry:entry + 4], "little") == 3:
            parser.error("the input must be statically linked (build with CGO_ENABLED=0)")
    timestamp = int(os.environ.get("SOURCE_DATE_EPOCH", datetime.now(timezone.utc).timestamp()))
    created = datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")
    layer_io = io.BytesIO()
    with tarfile.open(fileobj=layer_io, mode="w", format=tarfile.USTAR_FORMAT) as layer:
        for name, mode in [("app", 0o755), ("data", 0o700)]:
            info = tarfile.TarInfo(name)
            info.type = tarfile.DIRTYPE
            info.mode = mode
            info.uid = info.gid = 10001
            info.mtime = timestamp
            layer.addfile(info)
        add_file(layer, "app/chinacore-classroom", binary, timestamp, 0o755, 10001)
    layer_bytes = layer_io.getvalue()
    layer_id = hashlib.sha256(layer_bytes).hexdigest()
    config = {
        "created": created,
        "architecture": args.arch,
        "os": "linux",
        "config": {
            "User": "10001:10001",
            "ExposedPorts": {"18080/tcp": {}},
            "Env": ["PORT=18080", "DATA_FILE=/data/classroom.db"],
            "Entrypoint": ["/app/chinacore-classroom"],
            "WorkingDir": "/app",
            "StopSignal": "SIGTERM",
            "Healthcheck": {
                "Test": ["CMD", "/app/chinacore-classroom", "healthcheck"],
                "Interval": 30000000000,
                "Timeout": 5000000000,
                "StartPeriod": 10000000000,
                "Retries": 3,
            },
            "Labels": {"org.opencontainers.image.title": "chinacore-classroom"},
        },
        "rootfs": {"type": "layers", "diff_ids": [f"sha256:{layer_id}"]},
        "history": [{"created": created, "created_by": "package-image.py: static scratch runtime"}],
    }
    config_bytes = compact_json(config)
    image_id = hashlib.sha256(config_bytes).hexdigest()
    config_path = f"{image_id}.json"
    layer_path = f"{layer_id}/layer.tar"
    manifest = [{"Config": config_path, "RepoTags": [args.tag], "Layers": [layer_path]}]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.output, "w", format=tarfile.USTAR_FORMAT) as archive:
        add_file(archive, config_path, config_bytes, timestamp)
        add_file(archive, layer_path, layer_bytes, timestamp)
        add_file(archive, "manifest.json", compact_json(manifest), timestamp)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix(args.output.suffix + ".sha256").write_text(
        f"{digest}  {args.output.name}\n", encoding="ascii"
    )
    print(f"Image: {args.tag} ({args.arch})")
    print(f"ID: sha256:{image_id}")
    print(f"Archive: {args.output.resolve()}")


if __name__ == "__main__":
    main()
