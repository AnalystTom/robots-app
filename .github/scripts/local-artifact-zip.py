import os
import sys
import zipfile
from pathlib import Path


def regular_files(start: Path):
    if start.is_symlink() or not start.exists():
        return
    if start.is_file():
        yield start
        return
    for directory, _, names in os.walk(start):
        for name in sorted(names):
            path = Path(directory) / name
            if not path.is_symlink() and path.is_file():
                yield path


def archive(output: str, paths: list[str]) -> int:
    working_directory = Path.cwd()
    count = 0
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zip_file:
        for given in paths:
            for path in regular_files(Path(given)):
                name = Path(os.path.relpath(os.path.abspath(path), working_directory)).as_posix()
                if name.startswith("../") or name == "..":
                    raise SystemExit(f"{given} is outside the working directory")
                zip_file.write(path, name)
                count += 1
    return count


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("Usage: local-artifact-zip <output.zip> <path>...")
    print(f"Archived {archive(sys.argv[1], sys.argv[2:])} file(s)")
