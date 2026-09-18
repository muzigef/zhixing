"""Read-only bundle/ZIP payload comparison. Never extract paths from the archive."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import zipfile


def digest_stream(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def manifest(application):
    root = Path(application)
    result = {}
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in directories[:] + files:
            file = Path(directory) / name
            metadata = file.lstat()
            if file.is_symlink():
                if name in directories:
                    directories.remove(name)
                value = os.readlink(file).encode("utf-8")
                record = {"kind": "link", "size": len(value), "sha256": hashlib.sha256(value).hexdigest()}
            elif stat.S_ISREG(metadata.st_mode):
                with file.open("rb") as stream:
                    record = {"kind": "file", "size": metadata.st_size, "sha256": digest_stream(stream)}
            elif stat.S_ISDIR(metadata.st_mode):
                continue
            else:
                raise ValueError("unsupported_bundle_entry")
            result[file.relative_to(root).as_posix()] = record
    if not result:
        raise ValueError("empty_bundle")
    return result


def verify_zip(archive, application, expected):
    prefix = Path(application).name + "/"
    actual = {}
    with zipfile.ZipFile(archive) as zipped:
        for item in zipped.infolist():
            name = item.filename
            if name.startswith("__MACOSX/"):
                continue  # Apple metadata only; no extraction or execution.
            if not name.startswith(prefix) or "\\" in name or ".." in name.split("/"):
                raise ValueError("archive_path_invalid")
            if item.is_dir():
                continue
            relative = name[len(prefix):]
            if relative in actual or relative not in expected:
                raise ValueError("archive_entry_conflict")
            target = expected[relative]
            kind = "link" if stat.S_ISLNK(item.external_attr >> 16) else "file"
            if item.file_size != target["size"] or kind != target["kind"]:
                raise ValueError("archive_entry_mismatch")
            with zipped.open(item) as stream:
                actual[relative] = {"kind": kind, "size": item.file_size, "sha256": digest_stream(stream)}
    if actual != expected:
        raise ValueError("archive_payload_changed")


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("zip", "directory"):
        raise ValueError("payload_arguments_invalid")
    mode, candidate, application = sys.argv[1:]
    expected = manifest(application)
    if mode == "zip":
        verify_zip(candidate, application, expected)
    elif manifest(candidate) != expected:
        raise ValueError("mounted_payload_changed")
    if manifest(application) != expected:
        raise ValueError("bundle_changed_during_check")
    print(json.dumps({"passed": True, "entries": len(expected), "manifestSha256": hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest()}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"passed": False, "reason": "payload_verification_failed"}))
        sys.exit(1)
