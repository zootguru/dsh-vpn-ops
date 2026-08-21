#!/bin/sh
# Fixed remote helper for dsh-vpn-ops. Configuration arrives as base64 JSON in
# a constrained environment variable; model-provided shell text is never run.
set -eu
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

ACTION=${DSH_VPN_OPS_ACTION:-}
CONFIG_B64=${DSH_VPN_OPS_CONFIG_B64:-}
CONFIG_FILE=
LOCK_DIRECTORY=
ROLLBACK_ON_ERROR=false
ACTIVE_BACKUP_DIRECTORY=

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$ROLLBACK_ON_ERROR" = true ] && [ -n "$ACTIVE_BACKUP_DIRECTORY" ]; then
    restore_backup "$ACTIVE_BACKUP_DIRECTORY" >/dev/null 2>&1 || true
  fi
  [ -z "$LOCK_DIRECTORY" ] || rmdir "$LOCK_DIRECTORY" >/dev/null 2>&1 || true
  [ -z "$CONFIG_FILE" ] || rm -f "$CONFIG_FILE"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf '%s\n' "dsh-vpn-ops: $*" >&2
  exit 1
}

emit() {
  key=$1
  value=$2
  case "$key" in
    *[!a-z0-9_]*|'') fail "invalid response key" ;;
  esac
  case "$value" in
    *'\n'*|*'\r'*) fail "invalid response value" ;;
  esac
  printf '%s=%s\n' "$key" "$value"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

append_csv() {
  current=$1
  item=$2
  if [ -z "$current" ]; then printf '%s' "$item"; else printf '%s,%s' "$current" "$item"; fi
}

read_os_id() {
  if [ -r /etc/os-release ]; then
    sed -n 's/^ID=//p' /etc/os-release | head -n 1 | tr -d '"' | tr -cd 'A-Za-z0-9._-'
  else
    printf '%s' unknown
  fi
}

decode_config() {
  [ -n "$CONFIG_B64" ] || fail "missing deployment configuration"
  command_exists base64 || fail "base64 is required"
  command_exists jq || fail "jq is required"
  CONFIG_FILE=$(mktemp "${TMPDIR:-/tmp}/dsh-vpn-ops.XXXXXX")
  printf '%s' "$CONFIG_B64" | base64 -d >"$CONFIG_FILE" 2>/dev/null || fail "configuration is not valid base64"
  [ "$(jq -r '.schemaVersion // empty' "$CONFIG_FILE")" = 1 ] || fail "unsupported configuration schema"
}

json_string() {
  value=$(jq -er ".$1 | select(type == \"string\")" "$CONFIG_FILE") || fail "missing string configuration: $1"
  printf '%s' "$value"
}

json_integer() {
  value=$(jq -er ".$1 | select(type == \"number\" and floor == .)" "$CONFIG_FILE") || fail "missing integer configuration: $1"
  printf '%s' "$value"
}

validate_id() {
  case "$1" in
    ''|*[!a-z0-9._-]*) fail "unsafe identifier" ;;
  esac
}

validate_interface() {
  case "$1" in
    ''|*[!A-Za-z0-9_.-]*) fail "unsafe network interface" ;;
  esac
  [ "${#1}" -le 15 ] || fail "network interface is too long"
}

validate_service() {
  case "$1" in
    ''|*[!A-Za-z0-9_.@-]*) fail "unsafe service name" ;;
  esac
}

validate_path() {
  case "$1" in
    /*) ;;
    *) fail "remote path must be absolute" ;;
  esac
  case "$1" in
    *'..'*|*'//'|*[!A-Za-z0-9._/-]*) fail "unsafe remote path" ;;
  esac
}

validate_port() {
  case "$1" in ''|*[!0-9]*) fail "invalid port" ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ] || fail "port is out of range"
}

load_config() {
  [ "$(id -u)" -eq 0 ] || fail "remote helper must run as root (configure sudo: true when needed)"
  decode_config
  TARGET_ID=$(json_string targetId)
  PLAN_ID=$(json_string planId)
  PUBLIC_ENDPOINT=$(json_string publicEndpoint)
  PUBLIC_INTERFACE=$(json_string publicInterface)
  STATE_DIRECTORY=$(json_string remoteStateDirectory)
  WG_INTERFACE=$(json_string wireguardInterface)
  WG_ADDRESS=$(json_string wireguardAddress)
  WG_PORT=$(json_integer wireguardListenPort)
  WG_CONFIG=$(json_string wireguardConfigPath)
  WG_SERVICE=$(json_string wireguardService)
  CLIENT_DNS=$(json_string clientDns)
  CLIENT_MTU=$(json_integer clientMtu)
  VLESS_LISTEN=$(json_string vlessListenAddress)
  VLESS_PORT=$(json_integer vlessPort)
  REALITY_SERVER_NAME=$(json_string realityServerName)
  REALITY_DESTINATION=$(json_string realityDestination)
  XRAY_BINARY=$(json_string xrayBinary)
  XRAY_CONFIG=$(json_string xrayConfigPath)
  XRAY_SERVICE=$(json_string xrayService)
  SYSCTL_CONFIG=$(json_string sysctlConfigPath)

  validate_id "$TARGET_ID"
  validate_interface "$PUBLIC_INTERFACE"
  validate_interface "$WG_INTERFACE"
  validate_service "$WG_SERVICE"
  validate_service "$XRAY_SERVICE"
  validate_port "$WG_PORT"
  validate_port "$VLESS_PORT"
  validate_path "$STATE_DIRECTORY"
  case "$STATE_DIRECTORY" in */dsh-vpn-ops) ;; *) fail "state directory must end with /dsh-vpn-ops" ;; esac
  validate_path "$WG_CONFIG"
  validate_path "$XRAY_BINARY"
  validate_path "$XRAY_CONFIG"
  validate_path "$SYSCTL_CONFIG"
  [ "$(jq -r '.clients | type' "$CONFIG_FILE")" = array ] || fail "clients must be an array"
  [ "$(jq -r '.clients | length' "$CONFIG_FILE")" -gt 0 ] || fail "at least one client is required"
}

preflight() {
  os_id=$(read_os_id)
  os_supported=false
  case "$os_id" in debian|ubuntu) os_supported=true ;; esac
  missing=
  for command_name in base64 jq wg wg-quick ip iptables systemctl sysctl openssl sha256sum uuidgen ss mktemp install flock; do
    if ! command_exists "$command_name"; then missing=$(append_csv "$missing" "$command_name"); fi
  done
  if command_exists base64 && command_exists jq && [ -n "$CONFIG_B64" ]; then
    decode_config
    xray_binary=$(json_string xrayBinary)
    if [ ! -x "$xray_binary" ]; then missing=$(append_csv "$missing" xray); fi
  elif ! command_exists xray; then
    missing=$(append_csv "$missing" xray)
  fi
  emit schema 1
  emit os_id "$os_id"
  emit os_supported "$os_supported"
  emit architecture "$(uname -m | tr -cd 'A-Za-z0-9._-')"
  emit effective_uid "$(id -u)"
  emit missing_commands "$missing"
}

prepare_state() {
  install -d -m 700 "$STATE_DIRECTORY" "$STATE_DIRECTORY/secrets" "$STATE_DIRECTORY/clients" \
    "$STATE_DIRECTORY/backups"
}

acquire_lock() {
  LOCK_DIRECTORY="$STATE_DIRECTORY/lock"
  if ! mkdir "$LOCK_DIRECTORY" 2>/dev/null; then fail "another operation holds the target lock"; fi
  chmod 700 "$LOCK_DIRECTORY"
}

read_current_field() {
  field=$1
  if [ -f "$STATE_DIRECTORY/current.json" ]; then jq -r ".$field // empty" "$STATE_DIRECTORY/current.json"; fi
}

service_active() {
  if systemctl is-active --quiet "$1"; then printf '%s' true; else printf '%s' false; fi
}

udp_listening() {
  if ss -H -lun | awk '{print $5}' | grep -Eq "(^|[:.])$1$"; then printf '%s' true; else printf '%s' false; fi
}

tcp_listening() {
  if ss -H -ltn | awk '{print $4}' | grep -Eq "(^|[:.])$1$"; then printf '%s' true; else printf '%s' false; fi
}

peer_count() {
  if wg show "$WG_INTERFACE" peers >/dev/null 2>&1; then wg show "$WG_INTERFACE" peers | sed '/^$/d' | wc -l | tr -d ' '; else printf '%s' 0; fi
}

latest_handshake() {
  if wg show "$WG_INTERFACE" latest-handshakes >/dev/null 2>&1; then
    wg show "$WG_INTERFACE" latest-handshakes | awk 'BEGIN { max=0 } $2 > max { max=$2 } END { print max }'
  else
    printf '%s' 0
  fi
}

state_fingerprint() {
  {
    for managed_file in "$WG_CONFIG" "$XRAY_CONFIG" "$SYSCTL_CONFIG" "$STATE_DIRECTORY/current.json"; do
      if [ -f "$managed_file" ]; then sha256sum "$managed_file" | awk '{print $1}'; else printf '%s\n' absent; fi
    done
    service_active "$WG_SERVICE"
    service_active "$XRAY_SERVICE"
  } | sha256sum | awk '{print $1}'
}

status() {
  load_config
  emit schema 1
  emit deployment_id "$(read_current_field deploymentId)"
  emit backup_id "$(read_current_field backupId)"
  emit state_fingerprint "$(state_fingerprint)"
  emit wireguard_active "$(service_active "$WG_SERVICE")"
  emit xray_active "$(service_active "$XRAY_SERVICE")"
  emit wireguard_peers "$(peer_count)"
  emit latest_handshake_epoch "$(latest_handshake)"
  emit wireguard_port_listening "$(udp_listening "$WG_PORT")"
  emit vless_port_listening "$(tcp_listening "$VLESS_PORT")"
}

wg_config_valid() {
  [ -f "$WG_CONFIG" ] && wg-quick strip "$WG_CONFIG" >/dev/null 2>&1
}

xray_config_valid() {
  [ -f "$XRAY_CONFIG" ] || return 1
  "$XRAY_BINARY" run -test -config "$XRAY_CONFIG" >/dev/null 2>&1 || \
    "$XRAY_BINARY" -test -config "$XRAY_CONFIG" >/dev/null 2>&1
}

verify() {
  load_config
  wg_valid=false
  xray_valid=false
  services=false
  ports=false
  handshakes=false
  details=
  if wg_config_valid; then wg_valid=true; details=$(append_csv "$details" wireguard-config-ok); else details=$(append_csv "$details" wireguard-config-invalid); fi
  if xray_config_valid; then xray_valid=true; details=$(append_csv "$details" xray-config-ok); else details=$(append_csv "$details" xray-config-invalid); fi
  if [ "$(service_active "$WG_SERVICE")" = true ] && [ "$(service_active "$XRAY_SERVICE")" = true ]; then
    services=true; details=$(append_csv "$details" services-active)
  else
    details=$(append_csv "$details" services-inactive)
  fi
  if [ "$(udp_listening "$WG_PORT")" = true ] && [ "$(tcp_listening "$VLESS_PORT")" = true ]; then
    ports=true; details=$(append_csv "$details" ports-listening)
  else
    details=$(append_csv "$details" ports-not-listening)
  fi
  if [ "$(latest_handshake)" -gt 0 ]; then handshakes=true; details=$(append_csv "$details" handshake-seen); else details=$(append_csv "$details" no-handshake-yet); fi
  emit schema 1
  emit wireguard_config_valid "$wg_valid"
  emit xray_config_valid "$xray_valid"
  emit services_active "$services"
  emit ports_listening "$ports"
  emit handshakes_seen "$handshakes"
  emit details "$details"
}

generate_reality_keys() {
  output=$($XRAY_BINARY x25519 2>/dev/null) || fail "xray x25519 failed"
  private=$(printf '%s\n' "$output" | awk -F': *' 'tolower($1) == "privatekey" || tolower($1) == "private key" { print $2; exit }')
  public=$(printf '%s\n' "$output" | awk -F': *' 'tolower($1) == "publickey" || tolower($1) == "public key" || tolower($1) == "password" { print $2; exit }')
  [ -n "$private" ] && [ -n "$public" ] || fail "could not parse xray x25519 output"
  printf '%s\n' "$private" >"$STATE_DIRECTORY/secrets/reality.private"
  printf '%s\n' "$public" >"$STATE_DIRECTORY/secrets/reality.public"
  chmod 600 "$STATE_DIRECTORY/secrets/reality.private" "$STATE_DIRECTORY/secrets/reality.public"
}

ensure_secrets() {
  if [ ! -s "$STATE_DIRECTORY/secrets/wg-server.private" ]; then
    wg genkey >"$STATE_DIRECTORY/secrets/wg-server.private"
    chmod 600 "$STATE_DIRECTORY/secrets/wg-server.private"
  fi
  wg pubkey <"$STATE_DIRECTORY/secrets/wg-server.private" >"$STATE_DIRECTORY/secrets/wg-server.public"
  chmod 600 "$STATE_DIRECTORY/secrets/wg-server.public"
  if [ ! -s "$STATE_DIRECTORY/secrets/reality.private" ] || [ ! -s "$STATE_DIRECTORY/secrets/reality.public" ]; then generate_reality_keys; fi
  if [ ! -s "$STATE_DIRECTORY/secrets/reality.short-id" ]; then
    openssl rand -hex 8 >"$STATE_DIRECTORY/secrets/reality.short-id"
    chmod 600 "$STATE_DIRECTORY/secrets/reality.short-id"
  fi

  jq -c '.clients[]' "$CONFIG_FILE" | while IFS= read -r client; do
    client_id=$(printf '%s' "$client" | jq -er '.id')
    validate_id "$client_id"
    client_directory="$STATE_DIRECTORY/secrets/clients/$client_id"
    install -d -m 700 "$client_directory"
    if [ ! -s "$client_directory/wg.private" ]; then wg genkey >"$client_directory/wg.private"; fi
    wg pubkey <"$client_directory/wg.private" >"$client_directory/wg.public"
    if [ ! -s "$client_directory/vless.uuid" ]; then uuidgen | tr 'A-F' 'a-f' >"$client_directory/vless.uuid"; fi
    chmod 600 "$client_directory/wg.private" "$client_directory/wg.public" "$client_directory/vless.uuid"
  done
}

backup_file() {
  source_path=$1
  label=$2
  if [ -f "$source_path" ]; then
    cp -p "$source_path" "$ACTIVE_BACKUP_DIRECTORY/$label"
  else
    : >"$ACTIVE_BACKUP_DIRECTORY/$label.absent"
  fi
}

create_backup() {
  backup_id=$1
  ACTIVE_BACKUP_DIRECTORY="$STATE_DIRECTORY/backups/$backup_id"
  install -d -m 700 "$ACTIVE_BACKUP_DIRECTORY"
  backup_file "$WG_CONFIG" wireguard.conf
  backup_file "$XRAY_CONFIG" xray.json
  backup_file "$SYSCTL_CONFIG" sysctl.conf
  backup_file "$STATE_DIRECTORY/current.json" current.json
  if [ -d "$STATE_DIRECTORY/clients" ]; then cp -Rp "$STATE_DIRECTORY/clients" "$ACTIVE_BACKUP_DIRECTORY/clients"; fi
  service_active "$WG_SERVICE" >"$ACTIVE_BACKUP_DIRECTORY/wireguard.active"
  service_active "$XRAY_SERVICE" >"$ACTIVE_BACKUP_DIRECTORY/xray.active"
}

restore_one() {
  backup_directory=$1
  label=$2
  destination=$3
  if [ -f "$backup_directory/$label.absent" ]; then
    rm -f "$destination"
  elif [ -f "$backup_directory/$label" ]; then
    install -d -m 755 "$(dirname "$destination")"
    cp -p "$backup_directory/$label" "$destination"
  else
    fail "backup is missing $label"
  fi
}

restore_backup() {
  backup_directory=$1
  restore_one "$backup_directory" wireguard.conf "$WG_CONFIG"
  restore_one "$backup_directory" xray.json "$XRAY_CONFIG"
  restore_one "$backup_directory" sysctl.conf "$SYSCTL_CONFIG"
  restore_one "$backup_directory" current.json "$STATE_DIRECTORY/current.json"
  rm -rf "$STATE_DIRECTORY/clients"
  if [ -d "$backup_directory/clients" ]; then cp -Rp "$backup_directory/clients" "$STATE_DIRECTORY/clients"; else install -d -m 700 "$STATE_DIRECTORY/clients"; fi
  sysctl --system >/dev/null 2>&1 || true
  if [ "$(cat "$backup_directory/wireguard.active")" = true ]; then systemctl restart "$WG_SERVICE"; else systemctl stop "$WG_SERVICE" >/dev/null 2>&1 || true; fi
  if [ "$(cat "$backup_directory/xray.active")" = true ]; then systemctl restart "$XRAY_SERVICE"; else systemctl stop "$XRAY_SERVICE" >/dev/null 2>&1 || true; fi
}

render_wireguard() {
  destination=$1
  server_private=$(cat "$STATE_DIRECTORY/secrets/wg-server.private")
  {
    printf '%s\n' '[Interface]'
    printf 'Address = %s\n' "$WG_ADDRESS"
    printf 'ListenPort = %s\n' "$WG_PORT"
    printf 'PrivateKey = %s\n' "$server_private"
    printf 'PostUp = iptables -A FORWARD -i %s -j ACCEPT; iptables -A FORWARD -o %s -j ACCEPT; iptables -t nat -A POSTROUTING -o %s -j MASQUERADE\n' "$WG_INTERFACE" "$WG_INTERFACE" "$PUBLIC_INTERFACE"
    printf 'PostDown = iptables -D FORWARD -i %s -j ACCEPT; iptables -D FORWARD -o %s -j ACCEPT; iptables -t nat -D POSTROUTING -o %s -j MASQUERADE\n' "$WG_INTERFACE" "$WG_INTERFACE" "$PUBLIC_INTERFACE"
    jq -c '.clients[]' "$CONFIG_FILE" | while IFS= read -r client; do
      client_id=$(printf '%s' "$client" | jq -er '.id')
      address=$(printf '%s' "$client" | jq -er '.wireguardAddress')
      public_key=$(cat "$STATE_DIRECTORY/secrets/clients/$client_id/wg.public")
      printf '\n# client: %s\n[Peer]\nPublicKey = %s\nAllowedIPs = %s\n' "$client_id" "$public_key" "$address"
    done
  } >"$destination"
  chmod 600 "$destination"
}

render_xray() {
  destination=$1
  # Build the VLESS client list from state without exposing UUIDs in process arguments.
  clients_file=$(mktemp "${TMPDIR:-/tmp}/dsh-vpn-clients.XXXXXX")
  printf '%s\n' '[]' >"$clients_file"
  jq -r '.clients[].id' "$CONFIG_FILE" | while IFS= read -r client_id; do
    uuid=$(cat "$STATE_DIRECTORY/secrets/clients/$client_id/vless.uuid")
    next=$(mktemp "${TMPDIR:-/tmp}/dsh-vpn-clients-next.XXXXXX")
    jq --arg id "$uuid" --arg email "$client_id" '. + [{id: $id, email: $email, flow: "xtls-rprx-vision"}]' "$clients_file" >"$next"
    mv "$next" "$clients_file"
  done
  private_key=$(cat "$STATE_DIRECTORY/secrets/reality.private")
  short_id=$(cat "$STATE_DIRECTORY/secrets/reality.short-id")
  jq -n \
    --arg listen "$VLESS_LISTEN" \
    --argjson port "$VLESS_PORT" \
    --slurpfile clients "$clients_file" \
    --arg destination "$REALITY_DESTINATION" \
    --arg server_name "$REALITY_SERVER_NAME" \
    --arg private_key "$private_key" \
    --arg short_id "$short_id" \
    '{log:{loglevel:"warning"},inbounds:[{listen:$listen,port:$port,protocol:"vless",settings:{clients:$clients[0],decryption:"none"},streamSettings:{network:"raw",security:"reality",realitySettings:{show:false,target:$destination,xver:0,serverNames:[$server_name],privateKey:$private_key,shortIds:[$short_id]}}}],outbounds:[{protocol:"freedom",tag:"direct"}]}' >"$destination"
  rm -f "$clients_file"
  chmod 600 "$destination"
}

render_clients() {
  server_public=$(cat "$STATE_DIRECTORY/secrets/wg-server.public")
  reality_public=$(cat "$STATE_DIRECTORY/secrets/reality.public")
  short_id=$(cat "$STATE_DIRECTORY/secrets/reality.short-id")
  jq -c '.clients[]' "$CONFIG_FILE" | while IFS= read -r client; do
    client_id=$(printf '%s' "$client" | jq -er '.id')
    address=$(printf '%s' "$client" | jq -er '.wireguardAddress')
    directory="$STATE_DIRECTORY/clients/$client_id"
    install -d -m 700 "$directory"
    private_key=$(cat "$STATE_DIRECTORY/secrets/clients/$client_id/wg.private")
    uuid=$(cat "$STATE_DIRECTORY/secrets/clients/$client_id/vless.uuid")
    {
      printf '%s\n' '[Interface]'
      printf 'PrivateKey = %s\nAddress = %s\nDNS = %s\nMTU = %s\n\n' "$private_key" "$address" "$CLIENT_DNS" "$CLIENT_MTU"
      printf '%s\n' '[Peer]'
      printf 'PublicKey = %s\nEndpoint = %s:%s\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n' "$server_public" "$PUBLIC_ENDPOINT" "$WG_PORT"
    } >"$directory/wireguard.conf"
    printf 'vless://%s@%s:%s?encryption=none&flow=xtls-rprx-vision&security=reality&sni=%s&fp=chrome&pbk=%s&sid=%s&type=tcp#%s\n' \
      "$uuid" "$PUBLIC_ENDPOINT" "$VLESS_PORT" "$REALITY_SERVER_NAME" "$reality_public" "$short_id" "$client_id" >"$directory/vless.txt"
    chmod 600 "$directory/wireguard.conf" "$directory/vless.txt"
  done
}

apply_changes() {
  load_config
  case "$PLAN_ID" in ''|*[!a-f0-9]* ) fail "apply requires a SHA-256 plan id" ;; esac
  [ "${#PLAN_ID}" -eq 64 ] || fail "apply requires a SHA-256 plan id"
  prepare_state
  acquire_lock
  current=$(read_current_field deploymentId)
  if [ "$current" = "$PLAN_ID" ]; then
    emit schema 1
    emit deployment_id "$PLAN_ID"
    emit backup_id "$(read_current_field backupId)"
    emit changed false
    return
  fi

  backup_id="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$PLAN_ID" | cut -c1-8)"
  create_backup "$backup_id"
  ROLLBACK_ON_ERROR=true
  ensure_secrets

  install -d -m 755 "$(dirname "$WG_CONFIG")" "$(dirname "$XRAY_CONFIG")" "$(dirname "$SYSCTL_CONFIG")"
  wg_temp=$(mktemp "${WG_CONFIG}.tmp.XXXXXX")
  xray_temp=$(mktemp "${XRAY_CONFIG}.tmp.XXXXXX")
  sysctl_temp=$(mktemp "${SYSCTL_CONFIG}.tmp.XXXXXX")
  render_wireguard "$wg_temp"
  render_xray "$xray_temp"
  printf '%s\n' 'net.ipv4.ip_forward=1' >"$sysctl_temp"
  chmod 644 "$sysctl_temp"

  validation_directory=$(mktemp -d "${TMPDIR:-/tmp}/dsh-vpn-validate.XXXXXX")
  cp "$wg_temp" "$validation_directory/$WG_INTERFACE.conf"
  wg-quick strip "$validation_directory/$WG_INTERFACE.conf" >/dev/null 2>&1 || fail "generated WireGuard configuration failed validation"
  "$XRAY_BINARY" run -test -config "$xray_temp" >/dev/null 2>&1 || \
    "$XRAY_BINARY" -test -config "$xray_temp" >/dev/null 2>&1 || fail "generated Xray configuration failed validation"
  rm -rf "$validation_directory"

  install -m 600 "$wg_temp" "${WG_CONFIG}.new"
  install -m 600 "$xray_temp" "${XRAY_CONFIG}.new"
  install -m 644 "$sysctl_temp" "${SYSCTL_CONFIG}.new"
  mv "${WG_CONFIG}.new" "$WG_CONFIG"
  mv "${XRAY_CONFIG}.new" "$XRAY_CONFIG"
  mv "${SYSCTL_CONFIG}.new" "$SYSCTL_CONFIG"
  rm -f "$wg_temp" "$xray_temp" "$sysctl_temp"
  render_clients
  sysctl --system >/dev/null
  systemctl enable "$WG_SERVICE" "$XRAY_SERVICE" >/dev/null
  systemctl restart "$WG_SERVICE"
  systemctl restart "$XRAY_SERVICE"
  jq -n --arg deployment "$PLAN_ID" --arg backup "$backup_id" \
    '{schemaVersion:1,deploymentId:$deployment,backupId:$backup}' >"$STATE_DIRECTORY/current.json.tmp"
  chmod 600 "$STATE_DIRECTORY/current.json.tmp"
  mv "$STATE_DIRECTORY/current.json.tmp" "$STATE_DIRECTORY/current.json"
  ROLLBACK_ON_ERROR=false

  emit schema 1
  emit deployment_id "$PLAN_ID"
  emit backup_id "$backup_id"
  emit changed true
}

rollback_changes() {
  load_config
  backup_id=${DSH_VPN_OPS_BACKUP_ID:-}
  case "$backup_id" in
    ????????T??????Z-????????) ;;
    *) fail "invalid backup id" ;;
  esac
  case "$backup_id" in *[!0-9TZ-a-f-]*) fail "invalid backup id" ;; esac
  prepare_state
  acquire_lock
  backup_directory="$STATE_DIRECTORY/backups/$backup_id"
  [ -d "$backup_directory" ] || fail "backup not found"
  restore_backup "$backup_directory"
  emit schema 1
  emit backup_id "$backup_id"
  emit restored true
}

export_secret() {
  load_config
  client_id=${DSH_VPN_OPS_CLIENT_ID:-}
  validate_id "$client_id"
  jq -e --arg id "$client_id" '.clients | any(.id == $id)' "$CONFIG_FILE" >/dev/null || fail "client is not configured"
  case "$ACTION" in
    export-wireguard) source_file="$STATE_DIRECTORY/clients/$client_id/wireguard.conf" ;;
    export-vless) source_file="$STATE_DIRECTORY/clients/$client_id/vless.txt" ;;
    *) fail "invalid export action" ;;
  esac
  [ -f "$source_file" ] || fail "client artifact does not exist"
  cat "$source_file"
}

case "$ACTION" in
  preflight) preflight ;;
  status) status ;;
  verify) verify ;;
  apply) apply_changes ;;
  rollback) rollback_changes ;;
  export-wireguard|export-vless) export_secret ;;
  *) fail "unsupported action" ;;
esac
