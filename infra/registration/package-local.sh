#!/usr/bin/env bash
set -euo pipefail
umask 077
archive="$(realpath -m "${1:?Specify the output .tar.gz path}")"
base="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
mkdir "$stage/robots-local"
cp "$base"/infra/compose/{install-images.sh,.env.images.example,docker-compose.images.yml,restrict-computer-egress.sh} "$stage/robots-local/"
cp "$base/infra/registration/install-local.sh" "$stage/robots-local/"
docker tag postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5 robots-registration/postgres:16
images=(robots-registration/app:local robots/computer:local robots-registration/postgres:16 busybox:1)
for image in "${images[@]}"; do
  [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == linux/amd64 ]]
done
docker save -o "$stage/robots-local/images.tar" "${images[@]}"
tar -C "$stage" -cf - robots-local | gzip -1 > "$archive.partial"
mv -- "$archive.partial" "$archive"
