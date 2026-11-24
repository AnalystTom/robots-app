import argparse
import hashlib
import json
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

parser = argparse.ArgumentParser(
    description="Publish the pinned Docker images from an extracted public installer OCI archive."
)
parser.add_argument("layout", type=Path)
parser.add_argument("--endpoint", required=True)
args = parser.parse_args()
bucket = "robots-public-installer"
s3 = boto3.client(
    "s3",
    endpoint_url=args.endpoint,
    region_name="auto",
    config=Config(
        signature_version="s3v4",
        request_checksum_calculation="when_required",
        response_checksum_validation="when_required",
    ),
)
release = json.loads(Path(__file__).with_name("desktop-images.json").read_text())


def verified_blob(digest):
    path = args.layout / "blobs" / "sha256" / digest.removeprefix("sha256:")
    with path.open("rb") as stream:
        if "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest() != digest:
            raise ValueError("Digest mismatch for " + digest)
    return path


def publish_manifest(key, manifest, media_type):
    try:
        existing = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    except ClientError as error:
        if error.response["ResponseMetadata"]["HTTPStatusCode"] != 404:
            raise
    else:
        if manifest != existing:
            raise ValueError("Published manifest already differs at " + key)
        return
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=manifest,
        ContentType=media_type,
        IfNoneMatch="*",
        CacheControl="public,max-age=31536000,immutable",
    )


blobs = []
manifests = []
for name in ("app", "computer"):
    digest = release[name]
    raw = verified_blob(digest).read_bytes()
    manifest = json.loads(raw)
    prefix = "v2/robots/" + name
    for entry in [manifest["config"], *manifest["layers"]]:
        path = verified_blob(entry["digest"])
        if path.stat().st_size != entry["size"]:
            raise ValueError("Invalid layer length")
        blobs.append((path, prefix + "/blobs/" + entry["digest"]))
    for reference in (digest, release["version"]):
        manifests.append(
            (prefix + "/manifests/" + reference, raw, manifest["mediaType"])
        )

s3.put_object(Bucket=bucket, Key="v2/", Body=b"{}", ContentType="application/json")
for path, key in blobs:
    try:
        stored = s3.head_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if error.response["ResponseMetadata"]["HTTPStatusCode"] != 404:
            raise
    else:
        if stored["ContentLength"] != path.stat().st_size:
            raise ValueError("Published blob has an unexpected length at " + key)
        continue
    s3.upload_file(
        str(path),
        bucket,
        key,
        ExtraArgs={
            "ContentType": "application/octet-stream",
            "CacheControl": "public,max-age=31536000,immutable",
        },
    )
for manifest in manifests:
    publish_manifest(*manifest)
