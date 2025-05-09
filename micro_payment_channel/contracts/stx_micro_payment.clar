;; Micropayment Channel Contract
;; Allows two parties to conduct numerous small transactions off-chain
;; Only the channel opening and closing require on-chain transactions

;; Error codes
(define-constant ERR_UNAUTHORIZED (err u1))
(define-constant ERR_CHANNEL_EXISTS (err u2))
(define-constant ERR_CHANNEL_NOT_FOUND (err u3))
(define-constant ERR_CHANNEL_CLOSED (err u4))
(define-constant ERR_INVALID_SIGNATURE (err u5))
(define-constant ERR_TIMEOUT_NOT_REACHED (err u6))
(define-constant ERR_INVALID_STATE (err u7))
(define-constant ERR_INSUFFICIENT_FUNDS (err u8))
(define-constant ERR_INVALID_AMOUNT (err u9))

;; Channel status enum
(define-constant CHANNEL_OPEN u1)
(define-constant CHANNEL_DISPUTED u2)
(define-constant CHANNEL_CLOSED u3)

;; Data structures
(define-map channels
  { channel-id: (buff 32) }
  {
    sender: principal,
    recipient: principal,
    sender-balance: uint,
    recipient-balance: uint,
    timeout-block: uint,
    nonce: uint,
    status: uint
  }
)

;; Track user nonces for channel creation
(define-map user-nonces
  { user: principal }
  { nonce: uint }
)

;; Track total funds locked in the contract
(define-data-var total-locked-funds uint u0)

;; Generate a unique channel ID from sender, recipient, and nonce
(define-private (generate-channel-id (sender principal) (recipient principal) (nonce uint))
  (sha256 (concat (concat (principal-to-buff sender) (principal-to-buff recipient)) (uint-to-buff nonce)))
)

;; Open a new payment channel
(define-public (open-channel (recipient principal) (timeout-blocks uint) (amount uint))
  (let
    (
      (sender tx-sender)
      (sender-nonce (get-user-nonce sender))
      (channel-id (generate-channel-id sender recipient sender-nonce))
    )
    ;; Check if amount is valid
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    
    ;; Check if channel already exists
    (asserts! (is-none (map-get? channels { channel-id: channel-id })) ERR_CHANNEL_EXISTS)
    
    ;; Transfer funds from sender to contract
    (try! (stx-transfer? amount sender (as-contract tx-sender)))
    
    ;; Update total locked funds
    (var-set total-locked-funds (+ (var-get total-locked-funds) amount))
    
    ;; Create the channel
    (map-set channels
      { channel-id: channel-id }
      {
        sender: sender,
        recipient: recipient,
        sender-balance: amount,
        recipient-balance: u0,
        timeout-block: (+ burn-block-height timeout-blocks),
        nonce: u0,
        status: CHANNEL_OPEN
      }
    )
    
    ;; Increment the user's nonce
    (map-set user-nonces
      { user: sender }
      { nonce: (+ sender-nonce u1) }
    )
    
    ;; Return the channel ID
    (ok channel-id)
  )
)

;; Get the current nonce for a user (for channel ID generation)
(define-private (get-user-nonce (user principal))
  (default-to u0 (get nonce (map-get? user-nonces { user: user })))
)

;; Close the channel with a signed state
(define-public (close-channel 
  (channel-id (buff 32)) 
  (sender-amount uint) 
  (recipient-amount uint) 
  (nonce uint) 
  (sender-signature (buff 65)))
  
  (let
    (
      (channel (unwrap! (map-get? channels { channel-id: channel-id }) ERR_CHANNEL_NOT_FOUND))
      (sender (get sender channel))
      (recipient (get recipient channel))
      (total-amount (+ sender-amount recipient-amount))
      (message-hash (sha256 (concat (concat (concat channel-id (uint-to-buff sender-amount)) 
                                           (uint-to-buff recipient-amount)) 
                                   (uint-to-buff nonce))))
    )
    
    ;; Check if channel is open
    (asserts! (is-eq (get status channel) CHANNEL_OPEN) ERR_CHANNEL_CLOSED)
    
    ;; Check if the nonce is greater than the current one
    (asserts! (> nonce (get nonce channel)) ERR_INVALID_STATE)
    
    ;; Check if the total amount matches the channel balance
    (asserts! (is-eq total-amount (+ (get sender-balance channel) (get recipient-balance channel))) ERR_INVALID_AMOUNT)
    
    ;; Verify the signature
    (asserts! (is-eq (unwrap! (secp256k1-recover? message-hash sender-signature) ERR_INVALID_SIGNATURE) 
                    (principal-to-buff sender)) 
              ERR_INVALID_SIGNATURE)
    
    ;; If called by recipient, close the channel immediately
    (if (is-eq tx-sender recipient)
      (close-and-distribute channel-id sender recipient sender-amount recipient-amount)
      ;; If called by sender, update the channel state and mark as disputed
      (begin
        (map-set channels
          { channel-id: channel-id }
          {
            sender: sender,
            recipient: recipient,
            sender-balance: sender-amount,
            recipient-balance: recipient-amount,
            timeout-block: (get timeout-block channel),
            nonce: nonce,
            status: CHANNEL_DISPUTED
          }
        )
        (ok true)
      )
    )
  )
)

;; Settle a disputed channel after timeout
(define-public (settle-disputed-channel (channel-id (buff 32)))
  (let
    (
      (channel (unwrap! (map-get? channels { channel-id: channel-id }) ERR_CHANNEL_NOT_FOUND))
    )
    
    ;; Check if channel is in disputed state
    (asserts! (is-eq (get status channel) CHANNEL_DISPUTED) ERR_INVALID_STATE)
    
    ;; Check if timeout has been reached
    (asserts! (>= burn-block-height (get timeout-block channel)) ERR_TIMEOUT_NOT_REACHED)
    
    ;; Close and distribute funds
    (close-and-distribute 
      channel-id 
      (get sender channel) 
      (get recipient channel) 
      (get sender-balance channel) 
      (get recipient-balance channel)
    )
  )
)

;; Helper function to close channel and distribute funds
(define-private (close-and-distribute 
  (channel-id (buff 32)) 
  (sender principal) 
  (recipient principal) 
  (sender-amount uint) 
  (recipient-amount uint))
  
  (let
    (
      (contract-principal (as-contract tx-sender))
      (total-amount (+ sender-amount recipient-amount))
    )
    
    ;; Update total locked funds
    (var-set total-locked-funds (- (var-get total-locked-funds) total-amount))
    
    ;; Transfer funds to sender
    (if (> sender-amount u0)
      (try! (as-contract (stx-transfer? sender-amount contract-principal sender)))
      true
    )
    
    ;; Transfer funds to recipient
    (if (> recipient-amount u0)
      (try! (as-contract (stx-transfer? recipient-amount contract-principal recipient)))
      true
    )
    
    ;; Mark channel as closed
    (map-set channels
      { channel-id: channel-id }
      {
        sender: sender,
        recipient: recipient,
        sender-balance: u0,
        recipient-balance: u0,
        timeout-block: (get timeout-block (unwrap-panic (map-get? channels { channel-id: channel-id }))),
        nonce: (get nonce (unwrap-panic (map-get? channels { channel-id: channel-id }))),
        status: CHANNEL_CLOSED
      }
    )
    
    (ok true)
  )
)

;; Force close a channel after timeout
(define-public (force-close-channel (channel-id (buff 32)))
  (let
    (
      (channel (unwrap! (map-get? channels { channel-id: channel-id }) ERR_CHANNEL_NOT_FOUND))
    )
    
    ;; Check if channel is open
    (asserts! (is-eq (get status channel) CHANNEL_OPEN) ERR_INVALID_STATE)
    
    ;; Check if timeout has been reached
    (asserts! (>= burn-block-height (get timeout-block channel)) ERR_TIMEOUT_NOT_REACHED)
    
    ;; Check if caller is the sender
    (asserts! (is-eq tx-sender (get sender channel)) ERR_UNAUTHORIZED)
    
    ;; Close and distribute funds based on initial state
    (close-and-distribute 
      channel-id 
      (get sender channel) 
      (get recipient channel) 
      (get sender-balance channel) 
      (get recipient-balance channel)
    )
  )
)

;; Get channel details
(define-read-only (get-channel-details (channel-id (buff 32)))
  (map-get? channels { channel-id: channel-id })
)

;; Helper function to convert uint to buff
(define-private (uint-to-buff (value uint))
  (unwrap-panic (to-consensus-buff? value))
)

;; Helper function to convert principal to buff
(define-private (principal-to-buff (value principal))
  (unwrap-panic (to-consensus-buff? value))
)