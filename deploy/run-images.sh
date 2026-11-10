#!/bin/sh
# Prepare the external runtime.env first. Never stores credentials in the image.
set -eu
: "${APP_IMAGE:?Set the approved application image tag or digest}"
: "${RUNTIME_ENV_FILE:?Set the absolute private runtime.env path}"
: "${TLS_CA_DIRECTORY:?Set the directory containing public MariaDB CA certificates only}"
provider=${1:-filesystem}
set -- docker run -d --name territorio-paysandu --init --restart unless-stopped \
  --user 1001:1001 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --cpus 1 --memory 1g --pids-limit 128 \
  --stop-timeout 30 --publish 127.0.0.1:3000:3000 \
  --log-opt max-size=10m --log-opt max-file=3 \
  --env-file "$RUNTIME_ENV_FILE" -e SECURITY_RATE_LIMIT_PROVIDER=standalone \
  --mount "type=bind,src=$TLS_CA_DIRECTORY,dst=/run/territorio-ca,readonly" \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,uid=1001,gid=1001,mode=0700 \
  --tmpfs /app/Frontend/.next/cache:rw,nosuid,size=128m,uid=1001,gid=1001,mode=0700
case "$provider" in
  filesystem)
    : "${IMAGES_SURVEY_HOST_DIRECTORY:?Set the confirmed physical current-images directory}"
    : "${IMAGES_HISTORICAL_HOST_DIRECTORY:?Set the confirmed physical historical-images directory}"
    set -- "$@" -e IMAGE_PROVIDER=filesystem \
      -e FILESYSTEM_IMAGES_SURVEY_DIRECTORY=/data/imagenes/actuales \
      -e FILESYSTEM_IMAGES_HISTORICAL_DIRECTORY=/data/imagenes/historicas \
      --mount "type=bind,src=$IMAGES_SURVEY_HOST_DIRECTORY,dst=/data/imagenes/actuales,readonly" \
      --mount "type=bind,src=$IMAGES_HISTORICAL_HOST_DIRECTORY,dst=/data/imagenes/historicas,readonly"
    ;;
  sftp)
    set -- "$@" -e IMAGE_PROVIDER=sftp
    if [ -n "${SFTP_PRIVATE_KEY_HOST_FILE:-}" ]; then
      set -- "$@" --mount "type=bind,src=$SFTP_PRIVATE_KEY_HOST_FILE,dst=/run/territorio-sftp/key,readonly" \
        -e SFTP_IMAGES_PRIVATE_KEY_FILE=/run/territorio-sftp/key
    fi
    ;;
  *) echo 'Expected provider: filesystem or sftp' >&2; exit 2 ;;
esac
exec "$@" "$APP_IMAGE"
