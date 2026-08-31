#!/usr/bin/env sh
set -eu

project="switchlane-demo-$$"
compose="docker compose -p $project -f docker-compose.demo.yml"

cleanup() {
  printf '%s\n' 'Cleaning up isolated demo resources...'
  $compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

printf '%s\n' 'Building and running the isolated Switchlane demo...'
$compose up --build --abort-on-container-exit --exit-code-from demo demo
