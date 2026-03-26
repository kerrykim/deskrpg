#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/spritesheets"
OUT_DIR="public/assets/spritesheets"

download() {
  local remote_path="$1"
  local local_path="$2"
  local dir
  dir="$(dirname "$local_path")"
  mkdir -p "$dir"

  if [[ -f "$local_path" ]]; then
    echo "SKIP $local_path"
    return
  fi

  if curl -sf -o "$local_path" "${BASE_URL}/${remote_path}"; then
    echo "OK   $local_path"
  else
    echo "FAIL $remote_path -> $local_path"
    rm -f "$local_path"
  fi
}

BODY_TYPES=(male female)
SKIN_VARIANTS=(light olive bronze brown black)
HAIR_STYLES=(bob longhawk messy1 pixie princess)
HAIR_VARIANTS=(raven brunette blonde redhead white)
CLOTHING_VARIANTS=(white maroon teal blue brown)
PANTS_VARIANTS=(teal white maroon brown black)
SHOE_VARIANTS=(brown black)

# --- Body ---
# Remote: body/bodies/{bodyType}/walk/{variant}.png
for bt in "${BODY_TYPES[@]}"; do
  for v in "${SKIN_VARIANTS[@]}"; do
    download "body/bodies/${bt}/walk/${v}.png" \
             "${OUT_DIR}/body/body/${bt}/walk/${v}.png"
  done
done

# --- Hair ---
# Remote: hair/{style}/adult/walk/{variant}.png  (repo uses "adult" not male/female)
# Local:  hair/{style}/{bodyType}/walk/{variant}.png
# Hair color mapping: brunette -> dark_brown on remote
declare -A HAIR_REMOTE_COLORS
HAIR_REMOTE_COLORS[raven]="raven"
HAIR_REMOTE_COLORS[brunette]="dark_brown"
HAIR_REMOTE_COLORS[blonde]="blonde"
HAIR_REMOTE_COLORS[redhead]="redhead"
HAIR_REMOTE_COLORS[white]="white"

# Hair style mapping: princess -> long_straight on remote (princess uses bg/fg layers)
declare -A HAIR_REMOTE_STYLES
HAIR_REMOTE_STYLES[bob]="bob"
HAIR_REMOTE_STYLES[longhawk]="longhawk"
HAIR_REMOTE_STYLES[messy1]="messy1"
HAIR_REMOTE_STYLES[pixie]="pixie"
HAIR_REMOTE_STYLES[princess]="long_straight"

for style in "${HAIR_STYLES[@]}"; do
  remote_style="${HAIR_REMOTE_STYLES[$style]}"
  for bt in "${BODY_TYPES[@]}"; do
    for v in "${HAIR_VARIANTS[@]}"; do
      remote_color="${HAIR_REMOTE_COLORS[$v]}"
      download "hair/${remote_style}/adult/walk/${remote_color}.png" \
               "${OUT_DIR}/hair/${style}/${bt}/walk/${v}.png"
    done
  done
done

# --- Torso ---
# longsleeve remote: torso/clothes/longsleeve/longsleeve/{bodyType}/walk/{variant}.png
# tunic remote:      torso/clothes/tunic/female/walk/{variant}.png (female only in repo)
# Local: torso/{style}/{bodyType}/walk/{variant}.png
for bt in "${BODY_TYPES[@]}"; do
  for v in "${CLOTHING_VARIANTS[@]}"; do
    download "torso/clothes/longsleeve/longsleeve/${bt}/walk/${v}.png" \
             "${OUT_DIR}/torso/longsleeve/${bt}/walk/${v}.png"
  done
done

for bt in "${BODY_TYPES[@]}"; do
  for v in "${CLOTHING_VARIANTS[@]}"; do
    # tunic only has female in repo; for male, use female sprite as fallback
    remote_bt="female"
    if [[ "$bt" == "female" ]]; then
      remote_bt="female"
    fi
    download "torso/clothes/tunic/${remote_bt}/walk/${v}.png" \
             "${OUT_DIR}/torso/tunic/${bt}/walk/${v}.png"
  done
done

# --- Legs ---
# pants remote: legs/pants/{bodyType}/walk/{variant}.png
# skirt remote: legs/skirts/plain/{bodyType}/walk/{variant}.png  (skirts plural, plain substyle)
# Local: legs/{style}/{bodyType}/walk/{variant}.png
for bt in "${BODY_TYPES[@]}"; do
  for v in "${PANTS_VARIANTS[@]}"; do
    download "legs/pants/${bt}/walk/${v}.png" \
             "${OUT_DIR}/legs/pants/${bt}/walk/${v}.png"
  done
done

for bt in "${BODY_TYPES[@]}"; do
  for v in "${PANTS_VARIANTS[@]}"; do
    download "legs/skirts/plain/${bt}/walk/${v}.png" \
             "${OUT_DIR}/legs/skirt/${bt}/walk/${v}.png"
  done
done

# --- Feet ---
# Remote: feet/shoes/basic/{male|thin}/walk/{variant}.png  (basic substyle, female=thin)
# Local:  feet/shoes/{bodyType}/walk/{variant}.png
declare -A SHOE_REMOTE_BT
SHOE_REMOTE_BT[male]="male"
SHOE_REMOTE_BT[female]="thin"

for bt in "${BODY_TYPES[@]}"; do
  remote_bt="${SHOE_REMOTE_BT[$bt]}"
  for v in "${SHOE_VARIANTS[@]}"; do
    download "feet/shoes/basic/${remote_bt}/walk/${v}.png" \
             "${OUT_DIR}/feet/shoes/${bt}/walk/${v}.png"
  done
done

# --- Head (face outline) ---
# Remote: head/heads/human/{bodyType}/walk/{skinVariant}.png
# Local:  head/human/{bodyType}/walk/{variant}.png
for bt in "${BODY_TYPES[@]}"; do
  for v in "${SKIN_VARIANTS[@]}"; do
    download "head/heads/human/${bt}/walk/${v}.png" \
             "${OUT_DIR}/head/human/${bt}/walk/${v}.png"
  done
done

# --- Eyes ---
# Remote: eyes/human/adult/default/walk/{eyeColor}.png  (shared across body types)
# Local:  eyes/default/walk/{eyeColor}.png
EYE_COLORS=(blue brown gray green)
for ec in "${EYE_COLORS[@]}"; do
  download "eyes/human/adult/default/walk/${ec}.png" \
           "${OUT_DIR}/eyes/default/walk/${ec}.png"
done

# --- Nose ---
# Remote: head/nose/button/adult/walk/{skinVariant}.png  (shared across body types)
# Local:  nose/button/walk/{variant}.png
for v in "${SKIN_VARIANTS[@]}"; do
  download "head/nose/button/adult/walk/${v}.png" \
           "${OUT_DIR}/nose/button/walk/${v}.png"
done

echo ""
echo "Done!"
