"""Safely unpack the three user-supplied IAM archives; never download or redistribute them."""
import argparse
import shutil
import tarfile
from pathlib import Path


def unpack(archives, output):
    archives, output = Path(archives).resolve(), Path(output).resolve()
    for name in ("ascii", "xml", "lines"):
        target = output / name
        target.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archives / (name + ".tar")) as archive:
            for member in archive:
                relative = Path(member.name)
                if relative.parts and relative.parts[0] == name:
                    relative = Path(*relative.parts[1:])
                destination = (target / relative).resolve()
                if not destination.is_relative_to(target) or member.issym() or member.islnk():
                    raise ValueError(f"Unsafe archive member: {member.name}")
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if destination.exists():
                        if destination.stat().st_size != member.size:
                            raise ValueError(f"Existing file has a different size: {destination}")
                        continue
                    with archive.extractfile(member) as source, destination.open("wb") as sink:
                        shutil.copyfileobj(source, sink)
        print(f"Prepared {name}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archives", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    unpack(args.archives, args.output)
