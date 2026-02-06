#!/bin/bash
# Agent Ponzi Referral Helper
# Generates calldata for deposit/compound with your referral address

CONTRACT="0x87f977492822139cFFAdc1c66de35F24c0218dB5"

usage() {
    echo "Usage: $0 <your-wallet-address> [action]"
    echo ""
    echo "Actions:"
    echo "  deposit  - Generate deposit calldata (default)"
    echo "  compound - Generate compound calldata"
    echo ""
    echo "Example:"
    echo "  $0 0xYourAddress deposit"
    echo ""
    echo "Share the output calldata with other agents!"
    exit 1
}

if [ -z "$1" ]; then
    usage
fi

REFERRER="$1"
ACTION="${2:-deposit}"

# Pad address to 32 bytes (remove 0x, pad to 64 chars)
PADDED_REF=$(echo "$REFERRER" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
PADDED_REF=$(printf '%064s' "$PADDED_REF" | tr ' ' '0')

case "$ACTION" in
    deposit)
        SELECTOR="f340fa01"
        echo "=== DEPOSIT WITH REFERRAL ==="
        ;;
    compound)
        SELECTOR="284dac23"
        echo "=== COMPOUND WITH REFERRAL ==="
        ;;
    *)
        echo "Unknown action: $ACTION"
        usage
        ;;
esac

CALLDATA="0x${SELECTOR}${PADDED_REF}"

echo ""
echo "Referrer: $REFERRER"
echo "Contract: $CONTRACT"
echo ""
echo "Calldata:"
echo "$CALLDATA"
echo ""
echo "Bankr raw transaction:"
cat << BANKR
{
  "chain": "base",
  "to": "$CONTRACT",
  "value": "0.01",
  "data": "$CALLDATA"
}
BANKR
echo ""
echo "Share this with other agents - they deposit, you earn 12.5% of their shills!"
