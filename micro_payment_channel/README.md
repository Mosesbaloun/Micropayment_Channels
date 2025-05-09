# Stacks Micropayment Channel Contract

A trustless, efficient off-chain payment solution built on the Stacks blockchain.

## Overview

This smart contract implements a secure micropayment channel system allowing two parties to conduct numerous small transactions off-chain, with only the channel opening and closing requiring on-chain transactions. This significantly reduces transaction fees and improves scalability for applications requiring frequent, small-value transfers.

## Features

- **Off-chain Transactions**: Perform unlimited transactions without blockchain fees
- **Trustless Operation**: Secured by cryptographic signatures and timeouts
- **Bi-directional Payments**: Support for payments in both directions
- **Dispute Resolution**: Built-in mechanisms to handle uncooperative parties
- **Timelock Protection**: Automatic timeout protection to recover funds

## How It Works

1. **Channel Opening**: The sender creates a channel with the recipient and locks STX tokens
2. **Off-chain Transactions**: Parties exchange signed messages representing state updates
3. **Channel Closing**: 
   - Cooperative: Both parties agree on final balances
   - Unilateral: One party submits latest state and waits for timeout
   - Force close: Recover funds after timeout if counterparty disappears

## Contract Functions

### Public Functions

- `open-channel`: Create a new payment channel with specified recipient and lock funds
- `close-channel`: Close a channel with a signed state update
- `settle-disputed-channel`: Finalize a disputed channel after timeout period
- `force-close-channel`: Recover funds from a channel after timeout

### Read-only Functions

- `get-channel-details`: Retrieve current state of a payment channel

## Error Codes

- `ERR_UNAUTHORIZED (u1)`: Operation not permitted for caller
- `ERR_CHANNEL_EXISTS (u2)`: Channel with this ID already exists
- `ERR_CHANNEL_NOT_FOUND (u3)`: Channel with this ID does not exist
- `ERR_CHANNEL_CLOSED (u4)`: Operation not permitted on closed channel
- `ERR_INVALID_SIGNATURE (u5)`: Provided signature is invalid
- `ERR_TIMEOUT_NOT_REACHED (u6)`: Channel timeout period not yet expired
- `ERR_INVALID_STATE (u7)`: Invalid channel state for operation
- `ERR_INSUFFICIENT_FUNDS (u8)`: Not enough funds for operation
- `ERR_INVALID_AMOUNT (u9)`: Amount specified is invalid

## Usage Example

### Opening a Channel

```clarity
;; Sender opens channel with 1000 STX, valid for 144 blocks (about 1 day)
(contract-call? .micropayment-channel open-channel 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG u144 u1000)
```

### Off-chain Transaction

Parties exchange signed messages off-chain representing state updates. No blockchain transaction needed.

### Closing a Channel

```clarity
;; Close the channel with final balances
;; channel-id: The ID of the channel
;; sender-amount: STX returned to sender
;; recipient-amount: STX sent to recipient
;; nonce: Latest nonce (higher than previous)
;; sender-signature: Cryptographic signature proving sender authorized this state
(contract-call? .micropayment-channel close-channel 
  0x8a9c5862c2f6768b55dda622176257c93cf728a1ce510b81a196b0c5e2b5a212
  u600 u400 u5
  0x123abc... ;; signature bytes
)
```

## Security Considerations

- Always verify signatures before accepting off-chain payments
- Monitor channels to prevent timeout-based attacks
- Keep private keys secure to prevent unauthorized channel closures
- Implement proper nonce management to prevent replay attacks

## Development

This contract is written in Clarity, the smart contract language for the Stacks blockchain.

## License

MIT