import { describe, expect, it } from "vitest";

// Mock implementations to simulate contract behavior
class MockContract {
  private channels: Map<string, any> = new Map();
  private userNonces: Map<string, number> = new Map();
  private totalLockedFunds: number = 0;
  private currentBlockHeight: number = 0;

  // Simulate mining blocks
  mineBlocks(count: number) {
    this.currentBlockHeight += count;
  }

  // Get current block height
  getBlockHeight(): number {
    return this.currentBlockHeight;
  }

  // Generate a channel ID (simplified version of the contract's implementation)
  generateChannelId(sender: string, recipient: string, nonce: number): string {
    return `channel-${sender}-${recipient}-${nonce}`;
  }

  // Open a channel
  openChannel(sender: string, recipient: string, timeoutBlocks: number, amount: number) {
    // Check if amount is valid
    if (amount <= 0) {
      return { success: false, error: "err-invalid-amount" };
    }

    const senderNonce = this.userNonces.get(sender) || 0;
    const channelId = this.generateChannelId(sender, recipient, senderNonce);

    // Check if channel already exists
    if (this.channels.has(channelId)) {
      return { success: false, error: "err-channel-exists" };
    }

    // Create the channel
    this.channels.set(channelId, {
      sender,
      recipient,
      senderBalance: amount,
      recipientBalance: 0,
      timeoutBlock: this.currentBlockHeight + timeoutBlocks,
      nonce: 0,
      status: 1 // CHANNEL_OPEN
    });

    // Update nonce
    this.userNonces.set(sender, senderNonce + 1);

    // Update total locked funds
    this.totalLockedFunds += amount;

    return { success: true, result: channelId };
  }

  // Close a channel with a signed state
  closeChannel(channelId: string, senderAmount: number, recipientAmount: number, nonce: number, signature: string, caller: string) {
    // Check if channel exists
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { success: false, error: "err-channel-not-found" };
    }

    // Check if channel is open
    if (channel.status !== 1) {
      return { success: false, error: "err-channel-closed" };
    }

    // Check if the nonce is greater than the current one
    if (nonce <= channel.nonce) {
      return { success: false, error: "err-invalid-state" };
    }

    // Check if the total amount matches the channel balance
    if (senderAmount + recipientAmount !== channel.senderBalance + channel.recipientBalance) {
      return { success: false, error: "err-invalid-amount" };
    }

    // In a real implementation, we would verify the signature here
    // For this mock, we'll just assume it's valid if it's not empty
    if (!signature || signature === "invalid") {
      return { success: false, error: "err-invalid-signature" };
    }

    // If called by recipient, close the channel immediately
    if (caller === channel.recipient) {
      return this.closeAndDistribute(channelId, senderAmount, recipientAmount);
    } else {
      // If called by sender, update the channel state and mark as disputed
      channel.senderBalance = senderAmount;
      channel.recipientBalance = recipientAmount;
      channel.nonce = nonce;
      channel.status = 2; // CHANNEL_DISPUTED
      this.channels.set(channelId, channel);
      return { success: true, result: true };
    }
  }

  // Settle a disputed channel after timeout
  settleDisputedChannel(channelId: string) {
    // Check if channel exists
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { success: false, error: "err-channel-not-found" };
    }

    // Check if channel is in disputed state
    if (channel.status !== 2) {
      return { success: false, error: "err-invalid-state" };
    }

    // Check if timeout has been reached
    if (this.currentBlockHeight < channel.timeoutBlock) {
      return { success: false, error: "err-timeout-not-reached" };
    }

    // Close and distribute funds
    return this.closeAndDistribute(channelId, channel.senderBalance, channel.recipientBalance);
  }

  // Force close a channel after timeout
  forceCloseChannel(channelId: string, caller: string) {
    // Check if channel exists
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { success: false, error: "err-channel-not-found" };
    }

    // Check if channel is open
    if (channel.status !== 1) {
      return { success: false, error: "err-invalid-state" };
    }

    // Check if timeout has been reached
    if (this.currentBlockHeight < channel.timeoutBlock) {
      return { success: false, error: "err-timeout-not-reached" };
    }

    // Check if caller is the sender
    if (caller !== channel.sender) {
      return { success: false, error: "err-unauthorized" };
    }

    // Close and distribute funds
    return this.closeAndDistribute(channelId, channel.senderBalance, channel.recipientBalance);
  }

  // Helper function to close channel and distribute funds
  private closeAndDistribute(channelId: string, senderAmount: number, recipientAmount: number) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { success: false, error: "err-channel-not-found" };
    }

    // Update total locked funds
    this.totalLockedFunds -= (senderAmount + recipientAmount);

    // Mark channel as closed
    channel.senderBalance = 0;
    channel.recipientBalance = 0;
    channel.status = 3; // CHANNEL_CLOSED
    this.channels.set(channelId, channel);

    return { success: true, result: true };
  }

  // Get channel details
  getChannelDetails(channelId: string) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { success: true, result: null };
    }
    return { success: true, result: channel };
  }
}

describe("Micropayment Channel Contract", () => {
  // Helper function to create a mock signature
  function mockSignature(valid: boolean = true): string {
    return valid ? "valid-signature" : "invalid";
  }

  describe("Channel Creation", () => {
    it("should successfully open a payment channel", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // Open a channel with 1000 STX and 100 blocks timeout
      const result = contract.openChannel(sender, recipient, 100, 1000000000);
      
      // Assert that the operation was successful
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      
      // Verify channel was created
      const channelId = result.result as string;
      const channelDetails = contract.getChannelDetails(channelId);
      expect(channelDetails.success).toBe(true);
      expect(channelDetails.result).not.toBeNull();
      expect(channelDetails.result.sender).toBe(sender);
      expect(channelDetails.result.recipient).toBe(recipient);
      expect(channelDetails.result.senderBalance).toBe(1000000000);
    });

    it("should fail to open a channel with zero amount", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // Try to open a channel with 0 STX
      const result = contract.openChannel(sender, recipient, 100, 0);
      
      // Assert that the operation failed with the expected error
      expect(result.success).toBe(false);
      expect(result.error).toBe("err-invalid-amount");
    });
  });

  describe("Channel Operations", () => {
    it("should allow closing a channel with valid signature", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // First, open a channel
      const openResult = contract.openChannel(sender, recipient, 100, 1000000000);
      const channelId = openResult.result as string;
      
      // Close the channel with a valid signature
      const closeResult = contract.closeChannel(
        channelId,
        600000000, // 600 STX to sender
        400000000, // 400 STX to recipient
        1, // nonce
        mockSignature(true), // valid signature
        recipient // called by recipient
      );
      
      // Assert that the operation was successful
      expect(closeResult.success).toBe(true);
      expect(closeResult.result).toBe(true);
      
      // Verify channel was closed
      const channelDetails = contract.getChannelDetails(channelId);
      expect(channelDetails.result.status).toBe(3); // CHANNEL_CLOSED
    });

    it("should fail to close a channel with invalid signature", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // First, open a channel
      const openResult = contract.openChannel(sender, recipient, 100, 1000000000);
      const channelId = openResult.result as string;
      
      // Try to close the channel with an invalid signature
      const closeResult = contract.closeChannel(
        channelId,
        600000000,
        400000000,
        1,
        mockSignature(false), // invalid signature
        recipient
      );
      
      // Assert that the operation failed with the expected error
      expect(closeResult.success).toBe(false);
      expect(closeResult.error).toBe("err-invalid-signature");
    });

    it("should allow force-closing a channel after timeout", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // Open a channel with 10 blocks timeout
      const openResult = contract.openChannel(sender, recipient, 10, 1000000000);
      const channelId = openResult.result as string;
      
      // Mine 11 blocks to exceed the timeout
      contract.mineBlocks(11);
      
      // Force close the channel
      const closeResult = contract.forceCloseChannel(channelId, sender);
      
      // Assert that the operation was successful
      expect(closeResult.success).toBe(true);
      expect(closeResult.result).toBe(true);
      
      // Verify channel was closed
      const channelDetails = contract.getChannelDetails(channelId);
      expect(channelDetails.result.status).toBe(3); // CHANNEL_CLOSED
    });
  });

  describe("Channel Queries", () => {
    it("should retrieve channel details", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // First, open a channel
      const openResult = contract.openChannel(sender, recipient, 100, 1000000000);
      const channelId = openResult.result as string;
      
      // Query channel details
      const channelDetails = contract.getChannelDetails(channelId);
      
      // Assert that we got a result
      expect(channelDetails.success).toBe(true);
      expect(channelDetails.result).not.toBeNull();
      
      // Check specific fields
      expect(channelDetails.result.sender).toBe(sender);
      expect(channelDetails.result.recipient).toBe(recipient);
      expect(channelDetails.result.senderBalance).toBe(1000000000);
      expect(channelDetails.result.recipientBalance).toBe(0);
      expect(channelDetails.result.status).toBe(1); // CHANNEL_OPEN
    });
  });

  describe("Error Handling", () => {
    it("should fail when trying to close a non-existent channel", () => {
      const contract = new MockContract();
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // Try to close a non-existent channel
      const result = contract.closeChannel(
        "non-existent-channel",
        500000000,
        500000000,
        1,
        mockSignature(true),
        recipient
      );
      
      // Assert that the operation failed with the expected error
      expect(result.success).toBe(false);
      expect(result.error).toBe("err-channel-not-found");
    });

    it("should fail when unauthorized user tries to force-close", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // Open a channel
      const openResult = contract.openChannel(sender, recipient, 100, 1000000000);
      const channelId = openResult.result as string;
      
      // Mine blocks to exceed timeout
      contract.mineBlocks(101);
      
      // Try to force close from recipient (should fail)
      const closeResult = contract.forceCloseChannel(channelId, recipient);
      
      // Assert that the operation failed with the expected error
      expect(closeResult.success).toBe(false);
      expect(closeResult.error).toBe("err-unauthorized");
    });

    it("should fail to force-close before timeout", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // Open a channel with 100 blocks timeout
      const openResult = contract.openChannel(sender, recipient, 100, 1000000000);
      const channelId = openResult.result as string;
      
      // Mine only 50 blocks (not enough to reach timeout)
      contract.mineBlocks(50);
      
      // Try to force close before timeout
      const closeResult = contract.forceCloseChannel(channelId, sender);
      
      // Assert that the operation failed with the expected error
      expect(closeResult.success).toBe(false);
      expect(closeResult.error).toBe("err-timeout-not-reached");
    });
  });

  describe("Channel State Transitions", () => {
    it("should transition from open to disputed to closed", () => {
      const contract = new MockContract();
      const sender = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
      const recipient = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
      
      // Open a channel
      const openResult = contract.openChannel(sender, recipient, 100, 1000000000);
      const channelId = openResult.result as string;
      
      // Verify channel is open
      let channelDetails = contract.getChannelDetails(channelId);
      expect(channelDetails.result.status).toBe(1); // CHANNEL_OPEN
      
      // Update channel state (sender calls close-channel)
      const updateResult = contract.closeChannel(
        channelId,
        600000000,
        400000000,
        1,
        mockSignature(true),
        sender // called by sender, so it goes to disputed state
      );
      
      // Verify channel is disputed
      channelDetails = contract.getChannelDetails(channelId);
      expect(channelDetails.result.status).toBe(2); // CHANNEL_DISPUTED
      
      // Mine blocks to exceed timeout
      contract.mineBlocks(101);
      
      // Settle the disputed channel
      const settleResult = contract.settleDisputedChannel(channelId);
      
      // Verify channel is closed
      channelDetails = contract.getChannelDetails(channelId);
      expect(channelDetails.result.status).toBe(3); // CHANNEL_CLOSED
    });
  });
});