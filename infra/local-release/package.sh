#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
cd -- "$root"
out="$(realpath -m "${1:?Supply the output directory}")"
tag="${2:?Supply a release tag}"
[[ "$tag" =~ ^[0-9][0-9a-z.-]*$ ]] || exit 2
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
stage="$work/robots-local"
mkdir -p "$stage" "$work/build"
node infra/local-release/build-runtime.mjs "$work/build"
input="${ROBOTS_LOCAL_BUILD_IMAGE:-robots-local/private-build:$tag}"
if [[ -z "${ROBOTS_LOCAL_BUILD_IMAGE:-}" ]]; then
  docker build -f infra/compose/Dockerfile -t "$input" .
fi
docker build --build-arg "INPUT_IMAGE=$input" -f infra/local-release/Dockerfile -t "robots-local/app:$tag" "$work/build"
docker build --build-arg BROWSER=chromium -f infra/sandboxes/computer/Dockerfile -t "robots-local/computer:$tag" infra/sandboxes/computer
postgres=postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5
for image in "$postgres" busybox:1; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull --platform linux/amd64 "$image"
done
docker tag "$postgres" robots-local/postgres:16
cp infra/compose/{install-images.sh,.env.images.example,docker-compose.images.yml,restrict-computer-egress.sh} "$stage/"
cp infra/local-release/{docker-compose.override.yml,install-local.sh} LICENSE NOTICE "$stage/"
sed -i -e 's@ghcr.io/analysttom/robots-app/app@robots-local/app@g' -e 's@ghcr.io/analysttom/robots-app/computer@robots-local/computer@g' -e "s/IMAGE_TAG:-edge}/IMAGE_TAG:-$tag}/g" "$stage/docker-compose.images.yml"
sed -i -e 's@ghcr.io/analysttom/robots-app/app@robots-local/app@g' -e 's@ghcr.io/analysttom/robots-app/computer@robots-local/computer@g' -e "s/IMAGE_TAG=edge$/IMAGE_TAG=$tag/" "$stage/.env.images.example"
printf '\nPOSTGRES_IMAGE=robots-local/postgres:16\nBUSYBOX_IMAGE=busybox:1\n' >>"$stage/.env.images.example"
bash infra/local-release/check-runtime.sh "robots-local/app:$tag"
images=("robots-local/app:$tag" "robots-local/computer:$tag" robots-local/postgres:16 busybox:1)
for image in "${images[@]}"; do
  [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == linux/amd64 ]]
done
docker save -o "$stage/images.tar" "${images[@]}"
archive="robots-local-linux-amd64-$tag.tar.gz"
tar -C "$work" -cf - robots-local | gzip -1 > "$out/$archive.partial"
mv "$out/$archive.partial" "$out/$archive"
(cd "$out" && sha256sum "$archive" > "$archive.sha256")
