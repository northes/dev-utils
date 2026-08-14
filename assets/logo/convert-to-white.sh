#!/bin/sh
set -eu

input=${1:-brackets-curly-duotone.svg}
output=${2:-brackets-curly-duotone-white.svg}

if [ ! -f "$input" ]; then
  echo "找不到输入文件: $input" >&2
  exit 1
fi

{ sed 's/currentColor/#fff/g; s/" opacity="0.2"/" fill="#fff" opacity="0.2"/' "$input"; printf '\n'; } > "$output"
echo "已生成: $output"
