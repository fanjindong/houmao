#!/bin/sh
set -eu

test_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)

for test_file in "$test_dir"/*.test.js; do
  node --test "$test_file"
done
